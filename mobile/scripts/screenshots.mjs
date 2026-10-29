// Chụp ảnh màn hình nộp App Store (iPhone 6.9": 1320×2868) từ website thật, giả
// lập đúng app iOS (User-Agent có LinhPhuongApp nên ẩn đăng nhập mạng xã hội, chặn
// đặt thuốc kê đơn như trong app).
//
//   APP_REVIEW_USERNAME=0900000001 APP_REVIEW_PASSWORD=... \
//     node mobile/scripts/screenshots.mjs [https://duocphamlinhphuong.com] [thư-mục-ảnh]
//
// Luôn dùng tài khoản dùng thử của Apple (không lộ dữ liệu khách thật). Không có
// tài khoản thì chỉ chụp các trang công khai. GitHub Actions: workflow "App iOS"
// › Run workflow › chup_anh.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "https://duocphamlinhphuong.com").replace(/\/$/, "");
const outDir = path.resolve(process.argv[3] ?? "mobile/screenshots");
const username = process.env.APP_REVIEW_USERNAME ?? "";
const password = process.env.APP_REVIEW_PASSWORD ?? "";
mkdirSync(outDir, { recursive: true });

// 440×956 điểm × 3 = 1320×2868 điểm ảnh — cỡ Apple yêu cầu cho iPhone 6.9".
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: "vi-VN",
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinhPhuongApp/1.0",
});
const page = await context.newPage();

let loggedIn = false;
if (username && password) {
  const res = await page.request.post(`${base}/api/auth/login`, { data: { username, password } });
  if (!res.ok()) {
    console.error(`Đăng nhập tài khoản dùng thử thất bại (${res.status()}): ${await res.text()}`);
    process.exit(1);
  }
  // Bảng đồng ý điều khoản che màn hình: tài khoản dùng thử đồng ý sẵn.
  await page.request.post(`${base}/api/auth/accept-terms`, { data: {} });
  loggedIn = true;
} else {
  console.log("Không có APP_REVIEW_USERNAME/APP_REVIEW_PASSWORD — chỉ chụp trang công khai.");
}

async function shot(name, url, prepare) {
  await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
  if (prepare) await prepare();
  await page.waitForTimeout(800);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  • ${file}`);
}

await shot("1-tong-quan", loggedIn ? "/tong-quan" : "/");
await shot("2-danh-muc-san-pham", "/san-pham");
// Trang chi tiết: sản phẩm đầu tiên trong danh mục.
const productHref = await page
  .locator('a[href^="/san-pham/"]')
  .first()
  .getAttribute("href")
  .catch(() => null);
if (productHref) await shot("3-chi-tiet-san-pham", productHref);
if (loggedIn) {
  await shot("4-don-hang", "/don-hang");
  await shot("5-hop-dong-tich-luy", "/danh-muc-hop-dong");
  await shot("6-gio-hang", "/gio-hang");
}
await shot(loggedIn ? "7-khac" : "4-khac", "/khac");

await browser.close();
console.log(`Xong. Ảnh ở ${outDir} (1320×2868, tải lên App Store Connect › iPhone 6.9").`);
