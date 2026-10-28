import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { E2E_ADMIN } from "./credentials";

const SAMPLES = path.resolve(__dirname, "../../samples");
const resume = (name: string) => path.join(SAMPLES, "resumes", name);
const edge = (name: string) => path.join(SAMPLES, "edge-cases", name);

async function signIn(page: Page, password = E2E_ADMIN.password) {
  await page.getByLabel("Email").fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("access control: sign-in required, bad password rejected, deep links preserved, sign-out", async ({ page }) => {
  await page.goto("/history");
  await page.waitForURL(/\/login\?next=%2Fhistory/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await signIn(page, "definitely-wrong-password");
  await expect(page.getByText("The email or password is incorrect.")).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveValue("");

  await signIn(page);
  await page.waitForURL(/\/history$/);
  await expect(page.getByTestId("account")).toContainText("Administrator");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login$/);
  await page.goto("/");
  await page.waitForURL(/\/login$/);
});


test("core screening workflow: criteria → upload → shortlist → evidence → override → persistence → export", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

  // Sign in, then the overview with the demo mode label
  await page.goto("/");
  await page.waitForURL(/\/login/);
  await signIn(page);
  await expect(page.getByTestId("mode-label").first()).toHaveText(/Demo mode/i);

  // Job setup: extract, review, confirm
  await page.getByRole("link", { name: "New screening" }).first().click();
  await page.getByRole("button", { name: "Use sample job" }).click();
  await page.getByRole("button", { name: "Extract requirements" }).click();
  await expect(page.getByText(/fields? extracted automatically/)).toBeVisible();
  await page.getByRole("button", { name: /Confirm & create screening/ }).click();
  await expect(page.getByText("Please confirm you have reviewed the criteria.")).toBeVisible();
  await page.getByLabel("I have reviewed these criteria and confirm they are job-related.").check();
  await page.getByRole("button", { name: /Confirm & create screening/ }).click();
  await page.waitForURL(/\/screenings\/[a-f0-9]+\?tab=upload/);
  const screeningUrl = page.url().split("?")[0];

  // Mixed batch: valid PDF/DOCX, exact + near duplicates, corrupt, scanned, unsupported
  await page.getByTestId("file-input").setInputFiles([
    resume("amara-okafor.pdf"),
    resume("amara-okafor-copy.docx"),
    resume("daniel-reyes.docx"),
    resume("daniel-reyes-updated.pdf"),
    resume("mei-lin-chen.pdf"),
    resume("riley-morgan.pdf"),
    edge("corrupted-resume.pdf"),
    edge("scanned-image-only.pdf"),
    edge("notes.txt"),
  ]);
  await expect(page.getByText("Unsupported file type — upload PDF or DOCX.")).toBeVisible();
  await page.getByRole("button", { name: /Upload 8 files/ }).click();
  await expect(page.getByText(/8 of 8 file\(s\) processed/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("The PDF appears to be damaged: no readable pages were found.")).toBeVisible();
  await expect(page.getByText(/Scanned or image-only PDF/)).toBeVisible();
  await expect(page.getByText("Duplicate detected").first()).toBeVisible();

  // Shortlist: ranked candidates, duplicates and failures are not ranked
  await page.getByRole("tab", { name: /Shortlist/ }).click();
  await expect(page.getByTestId("candidate-row")).toHaveCount(5, { timeout: 30_000 });
  const unranked = page.getByTestId("unranked-row");
  await expect(unranked).toHaveCount(3);
  await expect(unranked.filter({ hasText: "excluded so the same resume isn't counted twice" })).toHaveCount(1);
  await expect(page.getByText("Possible duplicate · 8", { exact: false })).toBeVisible();
  const first = page.getByTestId("candidate-row").first();
  await expect(first).toContainText("Amara Okafor");

  // Filters: menu → active chip → narrowed list → clear
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("menuitemradio", { name: "Strong match" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Recommendation: Strong match")).toBeVisible();
  await expect(page.getByTestId("candidate-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByTestId("candidate-row")).toHaveCount(5);

  // Sortable header: candidate name ascending, then descending
  await page.getByRole("button", { name: /^Sort by Candidate/ }).click();
  await expect(page.getByTestId("candidate-row").first()).toContainText("Amara Okafor");
  await page.getByRole("button", { name: /^Sort by Candidate/ }).click();
  await expect(page.getByTestId("candidate-row").first()).toContainText("Riley Morgan");
  await page.getByRole("button", { name: /^Sort by #/ }).click();
  await expect(page.getByTestId("candidate-row").first()).toContainText("Amara Okafor");

  // Quick decision from the row menu (no override needed for Mei: potential → hold)
  const mei = page.getByTestId("candidate-row").filter({ hasText: "Mei Lin Chen" });
  await mei.getByRole("button", { name: /More actions/ }).click();
  await page.getByRole("menuitem", { name: /Record decision/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: /Hold/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText(/Recruiter decision recorded: Hold/)).toBeVisible();
  await expect(mei).toContainText("Hold");

  // Evidence drawer
  await first.click();
  await expect(page.getByTestId("drawer-title")).toHaveText("Amara Okafor");
  await expect(page.getByText("How the score was calculated")).toBeVisible();
  await expect(page.getByText("Exact quote · verified in resume").first()).toBeVisible();
  await page.getByRole("button", { name: "Show in resume" }).first().click();
  await expect(page.locator("mark.evidence-mark[data-active='true']")).toBeVisible();

  // Override with reason; original assessment stays visible
  await page.getByRole("tab", { name: /^Decision/ }).click();
  await page.getByRole("radio", { name: /Hold/ }).click();
  await expect(page.getByText("This is an override")).toBeVisible();
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("Please record a reason for this decision.")).toBeVisible();
  await page.getByLabel(/Reason/).fill("Waiting for confirmation of start date before advancing.");
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText(/Recruiter decision recorded: Hold/)).toBeVisible();
  await expect(page.getByText("AI recommendation at the time: Strong match")).toBeVisible();
  await page.getByRole("tab", { name: "Assessment" }).click();
  await expect(page.getByText(/^Original assessment ·/)).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Strong match").first()).toBeVisible();
  await expect(page.getByText("Change decision")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("drawer-title")).toBeHidden();

  // Navigate away and reopen from history: results and decision persist
  await page.getByRole("link", { name: "Screening history" }).click();
  await page.getByRole("link", { name: "Senior Backend Engineer (Python)" }).click();
  await expect(page).toHaveURL(new RegExp(screeningUrl));
  const reopened = page.getByTestId("candidate-row").first();
  await expect(reopened).toContainText("Amara Okafor");
  await expect(reopened).toContainText("Hold");
  await expect(reopened).toContainText("Override");

  // CSV export
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click().then(() => page.getByRole("menuitem", { name: /All resumes/ }).click()),
  ]);
  expect(download.suggestedFilename()).toMatch(/^talentlens-senior-backend-engineer-python-\d{8}\.csv$/);

  expect(consoleErrors).toEqual([]);
});
