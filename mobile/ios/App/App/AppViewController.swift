import UIKit
import WebKit
import Capacitor

/// Khung web của app (Capacitor) thêm cầu nối in của Quy chuẩn (`iosApp.nativeShell.print`, `qcPrint`):
/// WKWebView không làm gì khi trang gọi `window.print()`, nên web (qc-ios-app.ts, qc-pdf-viewer.ts) gửi
/// `webkit.messageHandlers.qcPrint.postMessage({ title, pdf? })` — có `pdf` (base64) thì in đúng tệp PDF, không thì in trang đang xem.
/// Tệp này nằm ở mobile/ios-extra, `scripts/patch-ios.mjs` chép vào Xcode project.
class AppViewController: CAPBridgeViewController {
    private var printHandler: PrintHandler?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = webView else { return }
        let handler = PrintHandler(controller: self)
        // WKUserContentController giữ chặt handler; handler chỉ giữ yếu controller nên không vòng tham chiếu.
        webView.configuration.userContentController.add(handler, name: PrintHandler.name)
        printHandler = handler
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: PrintHandler.name)
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
