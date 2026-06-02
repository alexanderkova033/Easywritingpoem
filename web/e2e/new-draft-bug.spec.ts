import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("easy-poems:first-hint-dismissed", "1");
    localStorage.setItem("easy-poems:sample-dismissed", "1");
    localStorage.setItem("easy-poems:landing-dismissed", "1");
  });
  await page.reload();
  await page.locator(".cm-content").waitFor({ state: "visible", timeout: 10000 });
});

test("clicking New draft clears the editor body", async ({ page }) => {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.type("hello world from previous draft");
  await page.waitForTimeout(300);

  await page.locator('button[aria-label="New draft"]').click();
  await page.waitForTimeout(300);

  const afterText = await page.locator(".cm-content").innerText();
  expect(afterText).not.toContain("hello world from previous draft");

  const title = await page.locator("#poem-title").inputValue();
  expect(title).toBe("");
});

test("switching back to the previous draft restores its body", async ({ page }) => {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.type("first draft content");
  await page.waitForTimeout(300);

  await page.locator('button[aria-label="New draft"]').click();
  await page.waitForTimeout(200);

  await editor.click();
  await page.keyboard.type("second draft content");
  await page.waitForTimeout(300);

  const draftSelect = page.locator('select[aria-label="Active draft"]');
  const optionValues = await draftSelect.locator("option").evaluateAll((els) =>
    (els as HTMLOptionElement[]).map((e) => e.value),
  );
  await draftSelect.selectOption(optionValues[0]);
  await page.waitForTimeout(500);

  const restoredText = await page.locator(".cm-content").innerText();
  expect(restoredText).toContain("first draft content");
  expect(restoredText).not.toContain("second draft content");
});
