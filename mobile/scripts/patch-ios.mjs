// Vá Xcode project do `cap add ios` sinh ra cho đúng yêu cầu App Store.
// Chạy lại nhiều lần vẫn an toàn (npm run ios:sync tự gọi).
//
// * Info.plist: lý do xin quyền máy ảnh/thư viện ảnh (gửi ảnh trong chat), Face ID, không
//   dùng mã hoá riêng (ITSAppUsesNonExemptEncryption = NO), nhận thông báo nền,
//   chỉ mở tên miền công ty (WKAppBoundDomains), tiếng Việt, chỉ iPhone dọc.
// * App.entitlements: bật Push Notifications (aps-environment).
// * PrivacyInfo.xcprivacy: khai báo dữ liệu thu thập, không theo dõi (bắt buộc từ 2024).
// * AppDelegate.swift: chuyển mã thiết bị APNs cho plugin PushNotifications.
// * project.pbxproj: gắn entitlements + PrivacyInfo + AppViewController.swift, chỉ iPhone, iOS ≥ 16.4.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "ios", "App", "App");
const pbxPath = join(root, "ios", "App", "App.xcodeproj", "project.pbxproj");
if (!existsSync(app)) {
  console.error("Chưa có thư mục ios/. Chạy: npm run ios:add");
  process.exit(1);
}
const log = (msg) => console.log(`  • ${msg}`);

// ---------------------------------------------------------------- Info.plist
const plistPath = join(app, "Info.plist");
let plist = readFileSync(plistPath, "utf8");
const setKey = (key, xml) => {
  const re = new RegExp(`\\s*<key>${key}</key>\\s*(<string>[^<]*</string>|<true/>|<false/>|<array>[\\s\\S]*?</array>|<dict>[\\s\\S]*?</dict>)`);
  plist = re.test(plist) ? plist.replace(re, `\n\t<key>${key}</key>\n\t${xml}`) : plist.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n\t${xml}\n</dict>\n</plist>\n`);
};
setKey("CFBundleDevelopmentRegion", "<string>vi</string>");
setKey("CFBundleDisplayName", "<string>Dược365</string>");
setKey("CFBundleLocalizations", "<array>\n\t\t<string>vi</string>\n\t</array>");
setKey("NSCameraUsageDescription", "<string>Quét mã vạch, mã QR trên hộp thuốc để tìm sản phẩm; chụp ảnh gửi cho nhân viên công ty trong khung chat (ví dụ ảnh chứng từ, ảnh sản phẩm) và gọi video trong chat.</string>");
// Face ID (plugin @capgo/capacitor-native-biometric): thiếu khoá này app sẽ thoát khi hỏi Face ID.
setKey("NSFaceIDUsageDescription", "<string>Dùng Face ID để đăng nhập nhanh và xác nhận đặt hàng, huỷ đơn, nhận hàng thay cho mật khẩu. Khuôn mặt chỉ được iPhone kiểm tra, không gửi đi đâu.</string>");
setKey("NSMicrophoneUsageDescription", "<string>Dùng micro cho cuộc gọi thoại và video với nhân viên công ty trong khung chat.</string>");
setKey("NSPhotoLibraryUsageDescription", "<string>Chọn ảnh trong thư viện để gửi cho nhân viên công ty trong khung chat.</string>");
setKey("NSPhotoLibraryAddUsageDescription", "<string>Lưu ảnh sản phẩm hoặc chứng từ vào thư viện ảnh khi bạn chọn lưu.</string>");
setKey("ITSAppUsesNonExemptEncryption", "<false/>");
setKey("UIBackgroundModes", "<array>\n\t\t<string>remote-notification</string>\n\t</array>");
// Tên miền chính duoc365.com (cả tên miền con chat., drive., id., meet., pay.… — WebKit so theo tên miền gốc) và tên miền phụ.
setKey("WKAppBoundDomains", "<array>\n\t\t<string>duoc365.com</string>\n\t\t<string>duocphamlinhphuong.com</string>\n\t</array>");
setKey("UIRequiredDeviceCapabilities", "<array>\n\t\t<string>arm64</string>\n\t</array>");
setKey("UISupportedInterfaceOrientations", "<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>");
writeFileSync(plistPath, plist);
log("Info.plist: lý do xin quyền, mã hoá, thông báo nền, tên miền, tiếng Việt, iPhone dọc");

// ---------------------------------------------------------- entitlements + privacy
copyFileSync(join(root, "ios-extra", "App.entitlements"), join(app, "App.entitlements"));
copyFileSync(join(root, "ios-extra", "PrivacyInfo.xcprivacy"), join(app, "PrivacyInfo.xcprivacy"));
log("App.entitlements (Push Notifications) và PrivacyInfo.xcprivacy");

// ---------------------------------------------------------- khung web + cầu nối in
// AppViewController (CAPBridgeViewController + `qcPrint` của QC iosApp.nativeShell.print): SceneDelegate dựng khung này.
copyFileSync(join(root, "ios-extra", "AppViewController.swift"), join(app, "AppViewController.swift"));
const scenePath = join(app, "SceneDelegate.swift");
const scene = readFileSync(scenePath, "utf8").replace("rootViewController = CAPBridgeViewController()", "rootViewController = AppViewController()");
writeFileSync(scenePath, scene);
log("AppViewController.swift: cầu nối in qcPrint; SceneDelegate dùng khung này");

// ---------------------------------------------------------------- AppDelegate
const delegatePath = join(app, "AppDelegate.swift");
let delegate = readFileSync(delegatePath, "utf8");
if (!delegate.includes("capacitorDidRegisterForRemoteNotifications")) {
  delegate = delegate.replace(
    /\n}\s*$/,
    `

    // Thông báo đẩy (plugin @capacitor/push-notifications): chuyển mã thiết bị
    // APNs cho Capacitor để website gửi về máy chủ.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
}
`,
  );
  writeFileSync(delegatePath, delegate);
}
log("AppDelegate.swift: nhận mã thiết bị APNs");

// ---------------------------------------------------------------- project.pbxproj
let pbx = readFileSync(pbxPath, "utf8");
pbx = pbx.replace(/TARGETED_DEVICE_FAMILY = "1,2";/g, "TARGETED_DEVICE_FAMILY = 1;");
if (!pbx.includes("CODE_SIGN_ENTITLEMENTS")) {
  pbx = pbx.replace(/(\t+)INFOPLIST_FILE = App\/Info\.plist;/g, "$1CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n$1INFOPLIST_FILE = App/Info.plist;");
}
const FILE_REF = "A1B2C3D4E5F6071829304A5B";
const BUILD_FILE = "A1B2C3D4E5F6071829304A5C";
const ENT_REF = "A1B2C3D4E5F6071829304A5D";
if (!pbx.includes("PrivacyInfo.xcprivacy")) {
  // Tham chiếu tệp.
  pbx = pbx.replace(
    "/* End PBXFileReference section */",
    `\t\t${FILE_REF} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };\n` +
      `\t\t${ENT_REF} /* App.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = App.entitlements; sourceTree = "<group>"; };\n` +
      "/* End PBXFileReference section */",
  );
  // Tệp được đóng gói vào app.
  pbx = pbx.replace(
    "/* End PBXBuildFile section */",
    `\t\t${BUILD_FILE} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${FILE_REF} /* PrivacyInfo.xcprivacy */; };\n/* End PBXBuildFile section */`,
  );
  // Hiện trong nhóm App (cạnh Assets.xcassets).
  pbx = pbx.replace(
    /(\t+)(504EC30E1FED79650016851F \/\* Assets\.xcassets \*\/,)/,
    `$1$2\n$1${FILE_REF} /* PrivacyInfo.xcprivacy */,\n$1${ENT_REF} /* App.entitlements */,`,
  );
  // Giai đoạn Resources.
  pbx = pbx.replace(
    /(\t+)(504EC30F1FED79650016851F \/\* Assets\.xcassets in Resources \*\/,)/,
    `$1$2\n$1${BUILD_FILE} /* PrivacyInfo.xcprivacy in Resources */,`,
  );
}
// AppViewController.swift trong nhóm App và giai đoạn Sources.
const VC_REF = "A1B2C3D4E5F6071829304A5E";
const VC_BUILD = "A1B2C3D4E5F6071829304A5F";
if (!pbx.includes("AppViewController.swift")) {
  pbx = pbx.replace(
    "/* End PBXFileReference section */",
    `\t\t${VC_REF} /* AppViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = AppViewController.swift; sourceTree = "<group>"; };\n/* End PBXFileReference section */`,
  );
  pbx = pbx.replace(
    "/* End PBXBuildFile section */",
    `\t\t${VC_BUILD} /* AppViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${VC_REF} /* AppViewController.swift */; };\n/* End PBXBuildFile section */`,
  );
  pbx = pbx.replace(/(\t+)(504EC3071FED79650016851F \/\* AppDelegate\.swift \*\/,)/, `$1$2\n$1${VC_REF} /* AppViewController.swift */,`);
  pbx = pbx.replace(/(\t+)(504EC3081FED79650016851F \/\* AppDelegate\.swift in Sources \*\/,)/, `$1$2\n$1${VC_BUILD} /* AppViewController.swift in Sources */,`);
}
// iOS tối thiểu theo QC iosApp.nativeShell.minimumIOS (16.4: Web Push, Share Sheet tệp, WKWebView đủ API của web).
pbx = pbx.replace(/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;/g, "IPHONEOS_DEPLOYMENT_TARGET = 16.4;");
writeFileSync(pbxPath, pbx);
const ok = ["AppViewController.swift in Sources", "IPHONEOS_DEPLOYMENT_TARGET = 16.4;", "TARGETED_DEVICE_FAMILY = 1;", "CODE_SIGN_ENTITLEMENTS = App/App.entitlements;", "PrivacyInfo.xcprivacy in Resources"].every((s) => pbx.includes(s));
log(`project.pbxproj: ${ok ? "đã gắn entitlements, PrivacyInfo, chỉ iPhone" : "CHƯA VÁ ĐỦ — mở Xcode kiểm tra thủ công"}`);
if (!ok) process.exit(1);
console.log("Xong: Xcode project sẵn sàng. Mở bằng: npm run ios:open (trên máy Mac).");
