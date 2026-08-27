# Seasoned Tree Care — Google Ads Setup Guide

The best route for a local tree care company, in order of priority. Do these in
sequence — each step makes the next one cheaper and more effective.

## Step 0 — Before spending a dollar

1. **Google Business Profile (free).** Claim/verify your profile at
   business.google.com. Fill out services, service area, photos of real jobs,
   and start collecting reviews. Ads perform measurably better when they can
   show your review rating, and it's required for Local Services Ads.
2. **A landing page that converts.** Your ad should NOT point at a generic
   homepage. It needs: phone number tap-to-call at the top, a short quote
   request form, photos of your crew/equipment, "Licensed & Insured", your
   service area, and reviews. One page is enough.
3. **Call tracking + conversion tracking.** In Google Ads, set up:
   - "Calls from ads" conversion (call extension clicks)
   - "Calls from website" conversion (Google's call-tracking number swap)
   - Form-submission conversion on your quote form
   Without this you cannot tell which keywords make the phone ring, and
   Smart Bidding has nothing to optimize toward.

## Step 1 — Local Services Ads (start here)

For tree care, **Local Services Ads (LSA)** are usually the best first channel,
often better than regular Search ads:

- You pay **per lead** (a call or message), not per click — typically
  $25–$95/lead for tree services depending on market.
- You appear **above** all regular search ads with a "Google Guaranteed" badge.
- Requires: background check, proof of license (where applicable) and
  insurance, and reviews on your Business Profile.
- Sign up at ads.google.com/local-services-ads. Approval takes 1–3 weeks —
  start it now, run Search ads (Step 2) in the meantime.

## Step 2 — Search campaign

Regular Search ads catch everyone LSA doesn't, and give you full control over
messaging. The full build is in this folder:

| File | What it is |
|---|---|
| `campaign-plan.md` | Campaign structure, settings, budget, bidding strategy |
| `keywords.csv` | Keywords per ad group (phrase + exact match) |
| `negative-keywords.csv` | Terms to block (job seekers, DIY, freebie hunters) |
| `ads.csv` | Responsive Search Ad headlines & descriptions per ad group |

To use the CSVs: install **Google Ads Editor** (free desktop app), sign in,
then Account > Import > "Paste text" or "Import from file". Review the changes
it stages, then Post. Or copy/paste manually into the web UI — the build is
small enough.

**Fill in the placeholders first**: search for `[CITY]`, `[PHONE]`, and
`[YEARS]` in the files and replace with your city/service area, phone number,
and years in business.

## Step 3 — After 2–4 weeks of data

- Start on **Manual CPC or Maximize Clicks** (you won't have conversion data
  yet). Once you have ~15–30 recorded conversions, switch to **Maximize
  Conversions**, later add a target CPA.
- Check the **Search terms report** weekly. Add anything irrelevant as a
  negative keyword. This is the single highest-leverage 15 minutes per week.
- Pause keywords with 50+ clicks and zero calls/forms.
- Emergency/storm keywords spike after weather events — consider raising that
  ad group's bids for a few days after a storm.

## What to skip (for now)

- **Performance Max / Display / YouTube** — wastes budget for a local service
  business until Search is profitable and feeding it conversion data.
- **Broad match keywords** — burn money in this niche ("tree" matches a lot of
  gardening queries). Stick to phrase and exact match.
- **Hiring ads** — if you later want ads to recruit crew, that's a separate
  campaign with its own keywords ("tree climber jobs [CITY]"); never mix it
  with customer-facing ad groups.
