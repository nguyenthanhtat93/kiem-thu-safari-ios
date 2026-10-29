// Soát vỏ app iOS trước khi Archive / nộp App Store: `npm run check` (chạy được cả trên VPS, không cần Mac).
// Báo ĐẠT/LỖI từng mục kèm số quy định Apple / mục Quy chuẩn (`third_party/qc/ts/src/ios-app.ts`, `iosApp.nativeShell`,
// `iosApp.appStore`); lỗi nào cũng là lý do Apple có thể từ chối bản dựng. `--bo-qua-team`: dựng thử chưa có tài khoản Apple.
// `--mang`: hỏi thêm website thật (trang Chính sách / Điều khoản / Hỗ trợ / Xoá tài khoản, HTTPS, IPv6).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "ios", "App", "App");
let failed = 0;
const check = (label, ok, hint = "") => {
  console.log(`${ok ? "ĐẠT" : "LỖI"}  ${label}${!ok && hint ? `\n      → ${hint}` : ""}`);
  if (!ok) failed += 1;
};
const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const sync = "Chạy: node scripts/patch-ios.mjs (hoặc npm run ios:sync)";

// ------------------------------------------------------------------ Cấu hình Capacitor
const config = JSON.parse(read(join(root, "capacitor.config.json")) || "{}");
const SITE = "https://duoc365.com";
check("Bundle ID vn.duocphamlinhphuong.app (trùng App Store Connect, không đổi sau lần nộp đầu)", config.appId === "vn.duocphamlinhphuong.app");
check(`App mở ${SITE} qua HTTPS (ATS)`, config.server?.url === SITE && config.server?.cleartext === false);
check("Điều hướng chỉ trong tên miền công ty (duoc365.com, duocphamlinhphuong.com và tên miền con)",
  ["duoc365.com", "*.duoc365.com", "duocphamlinhphuong.com", "*.duocphamlinhphuong.com"].every((d) => config.server?.allowNavigation?.includes(d)));
check("Có trang báo mất mạng (errorPath) — 2.1 không trắng trang", Boolean(config.server?.errorPath) && existsSync(join(root, "www", config.server.errorPath)));
check("User-Agent có LinhPhuongApp (web ẩn đăng nhập Google/Facebook/X — 4.8, chặn đặt thuốc kê đơn — 1.4.3)", /LinhPhuongApp/.test(config.ios?.appendUserAgent ?? ""));
check("Chỉ mở tên miền ràng buộc (limitsNavigationsToAppBoundDomains)", config.ios?.limitsNavigationsToAppBoundDomains === true);
check("Đã có thư mục ios/", existsSync(app), "Chạy: npm run ios:add");

// ------------------------------------------------------------------ Info.plist
const plist = read(join(app, "Info.plist"));
const plistString = (key) => plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];
check("Tên hiển thị Dược365 (2.3.7: tên trên máy trùng tên app)", plistString("CFBundleDisplayName") === "Dược365", sync);
// 5.1.1(i) + QC nativeShell.usageDescriptions: lý do xin quyền tiếng Việt, nói rõ dùng để làm gì (≥ 30 ký tự).
for (const key of ["NSCameraUsageDescription", "NSFaceIDUsageDescription", "NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription", "NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription"]) {
  const text = plistString(key) ?? "";
  check(`5.1.1 Info.plist ${key} nói rõ mục đích`, text.length >= 30, sync);
}
// Không xin quyền app không dùng (5.1.1: khai thừa quyền bị từ chối).
for (const key of ["NSLocationWhenInUseUsageDescription", "NSLocationAlwaysAndWhenInUseUsageDescription", "NSContactsUsageDescription", "NSCalendarsUsageDescription", "NSUserTrackingUsageDescription", "NSBluetoothAlwaysUsageDescription"]) {
  check(`5.1.1 không xin quyền không dùng (${key})`, !plist.includes(`<key>${key}</key>`));
}
check("Khai không mã hoá riêng (ITSAppUsesNonExemptEncryption = NO, miễn hồ sơ xuất khẩu)", /ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(plist));
check("Nhận thông báo nền (remote-notification)", plist.includes("remote-notification"));
check("WKAppBoundDomains có duoc365.com và duocphamlinhphuong.com (QC nativeShell.appBoundDomains)",
  /WKAppBoundDomains<\/key>\s*<array>[\s\S]*?duoc365\.com[\s\S]*?duocphamlinhphuong\.com[\s\S]*?<\/array>/.test(plist), sync);
check("ATS không mở HTTP (không NSAllowsArbitraryLoads)", !plist.includes("NSAllowsArbitraryLoads"));
check("Có màn khởi động (UILaunchStoryboardName) — bắt buộc từ 2020", plistString("UILaunchStoryboardName") === "LaunchScreen" && existsSync(join(app, "Base.lproj", "LaunchScreen.storyboard")));
check("Chỉ arm64 (không armv7)", plist.includes("<string>arm64</string>") && !plist.includes("armv7"));
check("Ngôn ngữ chính tiếng Việt", plistString("CFBundleDevelopmentRegion") === "vi");

// ------------------------------------------------------------------ Mã gốc
const spm = read(join(root, "ios", "App", "CapApp-SPM", "Package.swift"));
check("Có plugin Face ID trong Package.swift", spm.includes("CapgoCapacitorNativeBiometric"), "Chạy: npm install rồi npm run ios:sync");
const ent = read(join(app, "App.entitlements"));
check("App.entitlements bật Push Notifications", ent.includes("aps-environment"));
const delegate = read(join(app, "AppDelegate.swift"));
check("AppDelegate chuyển mã thiết bị APNs cho Capacitor", delegate.includes("capacitorDidRegisterForRemoteNotifications"));
const vc = read(join(app, "AppViewController.swift"));
check("Cầu nối in qcPrint (QC nativeShell.print: UIPrintInteractionController, in cả PDF)", vc.includes('"qcPrint"') && vc.includes("UIPrintInteractionController") && vc.includes("printingItem"), sync);
check("SceneDelegate dựng AppViewController", read(join(app, "SceneDelegate.swift")).includes("AppViewController()"), sync);
check("Không đụng API riêng của Apple (2.5.1)", !/_UIApplication|UIApplication\.shared\.perform\(|NSSelectorFromString/.test(vc + delegate));

// ------------------------------------------------------------------ Quyền riêng tư
const privacy = read(join(app, "PrivacyInfo.xcprivacy"));
check("PrivacyInfo.xcprivacy: không theo dõi, không tên miền theo dõi (5.1.2)", /NSPrivacyTracking<\/key>\s*<false\/>/.test(privacy) && /NSPrivacyTrackingDomains<\/key>\s*<array\/>/.test(privacy));
for (const type of ["Name", "PhoneNumber", "EmailAddress", "PhysicalAddress", "PurchaseHistory", "PhotosorVideos", "OtherUserContent", "UserID", "DeviceID", "ProductInteraction", "OtherFinancialInfo", "CustomerSupport", "OtherDataTypes", "CrashData", "SearchHistory"]) {
  check(`PrivacyInfo khai dữ liệu ${type} (khớp nhãn App Privacy)`, privacy.includes(`NSPrivacyCollectedDataType${type}<`));
}
check("PrivacyInfo khai lý do API UserDefaults (CA92.1)", privacy.includes("NSPrivacyAccessedAPICategoryUserDefaults") && privacy.includes("CA92.1"));

// ------------------------------------------------------------------ Xcode project
const pbx = read(join(root, "ios", "App", "App.xcodeproj", "project.pbxproj"));
check("Xcode project gắn entitlements", pbx.includes("CODE_SIGN_ENTITLEMENTS = App/App.entitlements;"));
check("Xcode project đóng gói PrivacyInfo.xcprivacy", pbx.includes("PrivacyInfo.xcprivacy in Resources"));
check("Xcode project biên dịch AppViewController.swift", pbx.includes("AppViewController.swift in Sources"), sync);
check("Chỉ iPhone (TARGETED_DEVICE_FAMILY = 1; iPad chạy chế độ tương thích, vẫn phải không văng)", pbx.includes("TARGETED_DEVICE_FAMILY = 1;") && !pbx.includes('TARGETED_DEVICE_FAMILY = "1,2"'));
const targets = [...pbx.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);/g)].map((m) => Number(m[1]));
check("iOS tối thiểu 16.4 (QC nativeShell.minimumIOS)", targets.length > 0 && targets.every((v) => v === 16.4), sync);
const version = pbx.match(/MARKETING_VERSION = ([^;]+);/)?.[1];
const build = pbx.match(/CURRENT_PROJECT_VERSION = ([^;]+);/)?.[1];
check("Có số phiên bản (MARKETING_VERSION) và số bản dựng", Boolean(version && build));
console.log(`      Phiên bản ${version} (bản dựng ${build}) — mỗi lần tải lên phải tăng số bản dựng (workflow dùng số lượt chạy).`);
const team = process.env.APPLE_TEAM_ID || pbx.match(/DEVELOPMENT_TEAM = ([^;]+);/)?.[1];
if (process.argv.includes("--bo-qua-team")) console.log("BỎ QUA  Team ký (dựng thử không ký — chưa có tài khoản Apple Developer)");
else check("Đã chọn Team ký (Signing & Capabilities)", Boolean(team && team !== '""'), "Cần tài khoản Apple Developer của công ty; đặt APPLE_TEAM_ID khi dựng");

// ------------------------------------------------------------------ Biểu tượng, màn chờ
const pngInfo = (path) => {
  const png = readFileSync(path);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), colorType: png[25] };
};
const icon = join(app, "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png");
if (existsSync(icon)) {
  const { width, height, colorType } = pngInfo(icon);
  check("Biểu tượng 1024×1024 không trong suốt (QC nativeShell.icon)", width === 1024 && height === 1024 && colorType === 2, "resources/icon.png là ảnh RGB, không alpha; chạy npm run ios:assets");
} else check("Có biểu tượng app", false, "Chạy: npm run ios:assets");
const splashDir = join(app, "Assets.xcassets", "Splash.imageset");
const splashFiles = existsSync(splashDir) ? readdirSync(splashDir).filter((f) => f.endsWith(".png")) : [];
const splashJson = read(join(splashDir, "Contents.json"));
check("Màn chờ đủ ảnh khai trong Contents.json, không ảnh thừa", splashFiles.length > 0 && splashFiles.every((f) => splashJson.includes(f)));

// ------------------------------------------------------------------ Website thật (tuỳ chọn)
if (process.argv.includes("--mang")) {
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinhPhuongApp/1.0";
  for (const path of ["/", "/chinh-sach-bao-mat", "/dieu-khoan-su-dung", "/ho-tro", "/xoa-tai-khoan", "/dang-nhap"]) {
    let ok = false;
    try { ok = (await fetch(SITE + path, { headers: { "user-agent": ua }, redirect: "follow" })).ok; } catch { /* mạng lỗi */ }
    check(`Website ${path} mở được khi chưa đăng nhập (5.1.1(i) URL Chính sách / Hỗ trợ cho App Store Connect)`, ok);
  }
  let health = false;
  try { health = (await (await fetch(`${SITE}/api/health`)).json()).status === "ok"; } catch { /* mạng lỗi */ }
  check("Máy chủ khoẻ (/api/health)", health);
}

console.log(failed ? `\n${failed} mục chưa đạt.` : "\nTất cả đạt — có thể Archive và nộp (còn các mục cần tài khoản Apple ở docs/app-store/README.md).");
process.exit(failed ? 1 : 0);
