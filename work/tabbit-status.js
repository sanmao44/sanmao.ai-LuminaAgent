return {
  title: await page.title(),
  url: page.url(),
  path: await page.evaluate(() => location.pathname),
  bridge: await page.locator('#sanmao-taiji-web-bridge-status').textContent(),
  version: await page.locator('#sanmao-taiji-web-bridge-status').getAttribute('data-bridge-version'),
};
