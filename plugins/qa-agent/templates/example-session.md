# Example: executing one test case with playwright-cli

A worked run of `TC-07 - Expired discount code is rejected`, from the test plan
through to the evidence a bug report needs. Copy the shape, not the values.

Shorthands used below:

```bash
R="python3 $CLAUDE_PLUGIN_ROOT/scripts/qa_record.py"
OUT=qa-results/tc-07
mkdir -p "$OUT"
```

## 1. Open the case

```bash
$R start TC-07 \
  --title "Expired discount code is rejected and the total is unchanged" \
  --base-url https://staging.example.com --priority P1 --covers AC-4
```

## 2. Start a session and reach the precondition

```bash
playwright-cli -s=qa state-load qa-results/session-buyer.json
playwright-cli -s=qa open https://staging.example.com/checkout
```

Save the snapshot into the case directory and read it before acting:

```bash
playwright-cli -s=qa snapshot --filename=$OUT/01-checkout.snapshot.md
```

```
- generic [active] [ref=e1]:
  - heading "Checkout" [level=1] [ref=e2]
  - paragraph [ref=e3]: "Order total: $120.00"
  - text: Discount code
  - textbox "Discount code" [ref=e4]
  - button "Apply" [ref=e5]
```

```bash
playwright-cli -s=qa screenshot --filename=$OUT/01-checkout.png
$R step TC-07 "Open the checkout page with one item in the cart" \
     --screenshot $OUT/01-checkout.png --snapshot $OUT/01-checkout.snapshot.md

playwright-cli -s=qa find "Order total: \$120.00"
# -> Found 1 match
$R check TC-07 "Order total starts at \$120.00"
```

The check passes because `find` located the text. Assert against the snapshot,
not against expectation.

## 3. Perform the action under test

```bash
playwright-cli -s=qa fill e4 "OLD2019"
playwright-cli -s=qa click e5

# capture the resulting state before anything alters it further
playwright-cli -s=qa snapshot --filename=$OUT/02-applied.snapshot.md
playwright-cli -s=qa highlight e3           # ring the total before capturing
playwright-cli -s=qa screenshot --filename=$OUT/02-applied.png

$R step TC-07 "Enter the expired code OLD2019 and click Apply" \
     --screenshot $OUT/02-applied.png --snapshot $OUT/02-applied.snapshot.md
```

Diffing the two saved snapshots shows exactly what the app changed - here the
total went from `$120.00` to `$96.00` and a "Discount applied" node appeared,
which is the defect stated in the app's own terms.

Now assert - once for what should be there, once for what is:

```bash
playwright-cli -s=qa find "This code has expired"
# -> No matches found for "This code has expired".

playwright-cli -s=qa find "Discount applied"
# -> Found 1 match. Order total now reads $96.00.
```

Those two answers are the Expected and Actual lines of the bug report.

## 4. Record the failure with expected and actual

The check label is the expected result copied verbatim from the test case, so it
becomes the bug report's "Expected result" line unchanged.

```bash
$R check TC-07 'Inline error reads "This code has expired"' \
     --fail \
     --actual 'Green "Discount applied" shown instead; order total changed to $96.00' \
     --screenshot $OUT/02-applied.png --snapshot $OUT/02-applied.snapshot.md
```

## 5. Capture the backend half

A UI symptom without the request behind it costs the developer a round trip.

```bash
playwright-cli -s=qa console  > $OUT/console.txt
playwright-cli -s=qa requests > $OUT/requests.txt
playwright-cli -s=qa request 4 > $OUT/discount-request.txt   # full exchange

$R evidence TC-07 --console $OUT/console.txt --requests $OUT/requests.txt \
     --note "endpoint=POST /v1/cart/discount returned 200 with discount 24.00"
```

## 6. Close the case

```bash
$R finish TC-07
```

```
[FAIL] TC-07 - Expired discount code is rejected and the total is unchanged
  ok   step: Open the checkout page with one item in the cart
  ok   check: Order total starts at $120.00
  ok   step: Enter the expired code OLD2019 and click Apply
  FAIL check: Inline error reads "This code has expired"
        actual: Green "Discount applied" shown instead; order total changed to $96.00
   evidence: /.../qa-results/tc-07  (2 screenshots, 2 page snapshots)
```

If `finish` reports zero page snapshots, the run is under-evidenced - go back
and capture the state before closing the case.

## 7. Re-run before filing

Run the case a second time and note whether it reproduced. Then classify it -
product defect, test defect, environment issue, or spec ambiguity - and only
then invoke **qa-bug**.

## 8. Report

```bash
python3 "$CLAUDE_PLUGIN_ROOT/scripts/build_report.py" ./qa-results \
  --title "Checkout discount codes - QA-4410" --summary summary.md \
  --out qa-report.html
```

If the project already has a Playwright suite that someone runs anyway, include
its output so the cycle produces one report. Executing a case is still
`playwright-cli` — this only folds in results that already exist:

```bash
npx playwright test --reporter=json > qa-results/playwright.json
python3 "$CLAUDE_PLUGIN_ROOT/scripts/build_report.py" ./qa-results \
  --playwright-json qa-results/playwright.json --out qa-report.html
```

## Naming promoted specs

Only relevant when the user has asked for automation. Keep the case ID at the
front of the test title so `build_report.py` can match the spec back to the plan:

```js
test('TC-07 expired discount code is rejected', async ({ page }) => { ... });
```
