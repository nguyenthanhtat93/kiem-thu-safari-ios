import UIKit
import WebKit
import Capacitor
import AuthenticationServices

/// Khung web của app (Capacitor) thêm cầu nối in của Quy chuẩn (`iosApp.nativeShell.print`, `qcPrint`):
/// WKWebView không làm gì khi trang gọi `window.print()`, nên web (qc-ios-app.ts, qc-pdf-viewer.ts) gửi
/// `webkit.messageHandlers.qcPrint.postMessage({ title, pdf? })` — có `pdf` (base64) thì in đúng tệp PDF, không thì in trang đang xem.
/// Cầu nối Sign in with Apple (`qcAppleSignIn`, chủ máy 03/11/2026, App Store 4.8): web gọi
/// `webkit.messageHandlers.qcAppleSignIn.postMessage({ nonce })`, app mở hộp Apple gốc (ASAuthorizationController) rồi trả kết quả
/// bằng sự kiện `qc-apple-signin` trên window: `{ ok, identityToken, authorizationCode, givenName, familyName }` hoặc
/// `{ ok: false, cancelled, error }`. Máy chủ kiểm identityToken (aud = Bundle ID) ở POST /api/auth/apple/native.
/// Tệp này nằm ở mobile/ios-extra, `scripts/patch-ios.mjs` chép vào Xcode project.
class AppViewController: CAPBridgeViewController {
    private var printHandler: PrintHandler?
    private var appleHandler: AppleSignInHandler?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = webView else { return }
        let handler = PrintHandler(controller: self)
        // WKUserContentController giữ chặt handler; handler chỉ giữ yếu controller nên không vòng tham chiếu.
        webView.configuration.userContentController.add(handler, name: PrintHandler.name)
        printHandler = handler
        let apple = AppleSignInHandler(controller: self)
        webView.configuration.userContentController.add(apple, name: AppleSignInHandler.name)
        appleHandler = apple
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: PrintHandler.name)
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: AppleSignInHandler.name)
    }

    /// Gửi kết quả Sign in with Apple về trang (sự kiện `qc-apple-signin`).
    fileprivate func sendAppleResult(_ result: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('qc-apple-signin', { detail: \(json) }))", completionHandler: nil)
    }

    fileprivate func print(title: String, pdf: Data?) {
        guard UIPrintInteractionController.isPrintingAvailable, let webView = webView else { return }
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = title.isEmpty ? "Dược365" : title
        let printer = UIPrintInteractionController.shared
        printer.printInfo = info
        if let pdf = pdf, UIPrintInteractionController.canPrint(pdf) {
            printer.printFormatter = nil
            printer.printingItem = pdf
        } else {
            printer.printingItem = nil
            printer.printFormatter = webView.viewPrintFormatter()
        }
        if UIDevice.current.userInterfaceIdiom == .pad {
            let anchor = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
            printer.present(from: anchor, in: webView, animated: true, completionHandler: nil)
        } else {
            printer.present(animated: true, completionHandler: nil)
        }
    }
}

private final class PrintHandler: NSObject, WKScriptMessageHandler {
    static let name = "qcPrint"
    private weak var controller: AppViewController?

    init(controller: AppViewController) {
        self.controller = controller
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == PrintHandler.name else { return }
        let body = message.body as? [String: Any] ?? [:]
        let title = body["title"] as? String ?? ""
        let pdf = (body["pdf"] as? String).flatMap { Data(base64Encoded: $0, options: .ignoreUnknownCharacters) }
        DispatchQueue.main.async { [weak controller] in
            controller?.print(title: title, pdf: pdf)
        }
    }
}

private final class AppleSignInHandler: NSObject, WKScriptMessageHandler, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {
    static let name = "qcAppleSignIn"
    private weak var controller: AppViewController?

    init(controller: AppViewController) {
        self.controller = controller
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == AppleSignInHandler.name else { return }
        let body = message.body as? [String: Any] ?? [:]
        DispatchQueue.main.async {
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            if let nonce = body["nonce"] as? String, !nonce.isEmpty { request.nonce = nonce }
            let auth = ASAuthorizationController(authorizationRequests: [request])
            auth.delegate = self
            auth.presentationContextProvider = self
            auth.performRequests()
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return self.controller?.view.window ?? ASPresentationAnchor()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken, let token = String(data: tokenData, encoding: .utf8) else {
            self.controller?.sendAppleResult(["ok": false, "cancelled": false, "error": "Apple không trả mã đăng nhập."])
            return
        }
        var result: [String: Any] = ["ok": true, "identityToken": token]
        if let codeData = credential.authorizationCode, let code = String(data: codeData, encoding: .utf8) { result["authorizationCode"] = code }
        if let given = credential.fullName?.givenName { result["givenName"] = given }
        if let family = credential.fullName?.familyName { result["familyName"] = family }
        self.controller?.sendAppleResult(result)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        self.controller?.sendAppleResult(["ok": false, "cancelled": cancelled, "error": error.localizedDescription])
    }
}
