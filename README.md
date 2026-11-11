# Leo Video Contest Voting - QA Automation Dashboard

A local web dashboard that bulk-submits the Jotform voting form
(`https://lionsclubs.jotform.com/253014062956050`) for a list of emails, so
you can QA the form's "one vote per 24 hours" and validation behavior.

For each email it:
1. Opens the form fresh (new browser context, no leftover cookies).
2. Selects the configured video option (default **Video 1**).
3. Fills the email field.
4. Clicks Submit and records whether the form confirmed or rejected it.
5. Waits a short delay, then repeats for the next email.

## Setup

```bash
npm install
```

`npm install` also runs `playwright install chromium` (via `postinstall`) to
download the browser binary Playwright needs. If that step gets skipped, run
it manually:

```bash
npx playwright install chromium
```

## Run

```bash
npm start
```

Then open **http://localhost:4300** in your browser.

## Using the dashboard

1. **Upload email list** - a `.csv` or `.txt` file with one email per line
   (a header row literally spelled `email` is ignored automatically).
   Set the video label (must match the form's option text exactly, e.g.
   `Video 1`), the delay between submissions, and whether to run headless.
2. Click **Load batch**, then **Start**.
3. Watch progress in the **Results** table (Pending / Approved / Failed) and
   the **Live terminal** panel, which streams every step as it happens.
4. **Pause** / **Resume** / **Cancel** control the run at any time.
5. Export the approved/failed/all lists as CSV from the Results panel.

### Dashboard refresh / disconnect behavior

If the browser tab running the dashboard is refreshed or closed while a batch
is **running**, the server detects the disconnect and pauses the batch as
soon as the in-flight submission finishes (it never aborts mid-submission).
When you reopen the dashboard, a modal appears telling you how far it got and
asking whether to **resume from where it left off** or **cancel and start a
new batch**. Job state is also persisted to `data/job-state.json`, so it
survives a server restart too.

## Notes & caveats

- The automation finds the video radio button and the email field using
  their **visible label text** (`page.getByLabel(...)`), which is how
  Jotform wires `<label for>` to each input. If Jotform changes the form's
  wording, update the "Video choice" field in the dashboard rather than
  editing code.
- Success/failure is classified by scanning the resulting page for
  thank-you vs. error/duplicate-vote text (see `server/automation.js`). Any
  ambiguous result is marked **failed** and a full-page screenshot is saved
  under `data/screenshots/` (served at `/screenshots/...`) so you can inspect
  exactly what the form showed.
- Run a small test batch (2-3 emails) first with "Run headless" unchecked so
  you can watch the browser and confirm it's clicking the right option before
  running a large list.
- Each submission uses a brand-new browser context (no shared cookies), so
  the dashboard isn't bypassing the form's own duplicate-vote logic - it's
  exercising it the way a real new visitor would.
