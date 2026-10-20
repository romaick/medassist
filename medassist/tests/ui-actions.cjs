"use strict";

async function clickAction(page, name) {
  const button = page.locator('[data-action="' + name + '"]').first();
  const changesPage = ["home", "patients", "new", "visit", "followups", "modules", "help"].includes(name) &&
    await button.evaluate(node => Boolean(node.closest(".navigation-header .nav")));
  const previousMain = changesPage ? await page.locator("#main").elementHandle() : null;
  await button.click();
  if (previousMain) {
    await page.waitForFunction(node => !node.isConnected, previousMain);
    await previousMain.dispose();
  }
}

async function selectFilter(page, kind, value) {
  const selector = '[data-action="' + kind + '-filter"][data-filter="' + value + '"]';
  await page.locator(selector).click();
  await page.locator(selector + '[aria-selected="true"]').waitFor({state: "visible"});
}

module.exports = {clickAction, selectFilter};
