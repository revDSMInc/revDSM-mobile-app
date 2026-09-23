# App-wide platform notes (fonts, iPad, images, logging, flash messages)

> Part of the repo guide — the index is the root `CLAUDE.md`. **Read this before changing:** `index.js`, `utils/default-font.ts`, `utils/keyboard-type.ts`, `utils/imageFileCache.ts`, `hooks/useWarmedImageUris.ts`, `widgets/common/PhotoPeekPressable.tsx`, `widgets/modals/CustomCameraModal.tsx`, `services/api/index.ts`, `utils/sanitize-for-log.ts`, `config/message.ts`.
>
> Each `##` section is one ticket: the ask, the root cause, the decision, and the ⚠️ traps that must not be
> "fixed" back. Newest follow-ups sit under their original ticket. Add new notes for this area HERE, not in the root file.

## iPad: numeric fields get a DOCKED keyboard, not iPadOS's floating palette

Ticket: *"Change UI of number pad — it should be like 2nd image"*, against a screenshot of the Deal
Center calculator on an iPad with a small floating keypad sitting on top of the Gutters rows it was
meant to fill in.

⚠️ **Not a layout bug, and no prop moves it.** iPadOS renders EVERY "pad" keyboard type — `number-pad`,
`decimal-pad`, and `numeric`, which react-native maps to `UIKeyboardTypeDecimalPad` on iOS — as a
compact FLOATING key palette anchored beside the field, with the phone-keypad `2 ABC / 3 DEF`
lettering. The presentation is Apple's, chosen from the keyboard type alone. A NON-pad type is drawn
as the ordinary full-width keyboard docked at the bottom, and that is the only lever there is.

**New `src/utils/keyboard-type.ts`** holds the decision once: `NUMERIC_KEYBOARD` /
`NUMBER_PAD_KEYBOARD` resolve to `numbers-and-punctuation` on iPad (`Platform.isPad`, no new
dependency) and to the previous `numeric` / `number-pad` everywhere else. **33 inputs across 19 files**
read them, each also gaining `returnKeyType="done"` for the Done key — which doubles as the keyboard
dismissal these fields never had.

- ⚠️ **It is a FULL keyboard, so it carries a letters key.** That is safe ONLY because all 33 consumers
  already strip non-numerics in `onChangeText` (or `parseFloat` the value) — checked before the sweep.
  Do not point these constants at a field that stores raw text.
- ⚠️ **`RolloutView`'s drop-price input had to be DISARMED, and this is the one with teeth.** It commits
  on `onBlur` precisely *because* iPhone's number pad has no return key, so `onSubmitEditing` never
  fires there (its own comment says so). Give iPad a Done key and BOTH fire — Done submits, then blurs —
  so `openDrop` would run **twice for one tap**, on the very screen whose duplicate `dropPrice` rows
  this file documents at length. **`NUMERIC_KEYBOARD_HAS_RETURN_KEY`** gates that blur commit now; read
  it before adding any other blur-as-submit workaround to a numeric field.
- ⚠️ `CalculatorSummary`'s equivalent blur commit is **unconditional** (it already coexists with
  `onSubmitEditing` on Android), so it was left alone — iPad simply behaves like Android does there.
- ⚠️ **The two OTP screens are deliberately EXCLUDED** (`auth/email-otp`, `auth/authenticator-otp`).
  They already own per-box `returnKeyType`/`onSubmitEditing`, and a full keyboard behind six
  single-character boxes is worse than the palette.
- **iPhone and Android are untouched by construction** — the constants resolve to the previous string
  literals there, so the change is a no-op off iPad.

## iPad: the camera viewfinder pushed the shutter button off the screen

Ticket: *"Screen cutoff on ipad — camera shoot button is not visible."*

`widgets/modals/CustomCameraModal.tsx` sized its 4:3 viewfinder from the WIDTH alone
(`screenWidth * (4 / 3)`) and never consulted the height, which silently assumes a phone:

| device | viewfinder | left for the bottom bar (needs ~200pt) |
|---|---|---|
| iPhone 14 Pro | 524pt | 249pt ✅ |
| iPad 10.9 | 1093pt | **43pt** |
| iPad Pro 12.9 | 1365pt | **−43pt** — the bar is off-screen entirely |

⚠️ **eslint had been reporting the cause for as long as the bug existed**: `'screenHeight' is assigned
a value but never used`. The layout destructured the screen height and then ignored it.

The viewfinder is now capped at the height that is actually left
(`screenHeight − viewfinderTop − insets.bottom − BOTTOM_CONTROLS_MIN_HEIGHT`), and **both** sides are
derived from whichever dimension binds, so the box stays a TRUE 4:3 and is centred rather than
stretched or cropped. On a phone the width still binds, so the geometry there is unchanged to the pixel.

- ⚠️ **iPhone SE was affected too** (427pt available against a 500pt viewfinder) — its shutter was being
  squeezed by the same sum, so this is a visible change on the smallest phones as well, not only iPad.
- ⚠️ **`Dimensions.get('window')` → `useWindowDimensions()`.** iPad allows landscape
  (`UISupportedInterfaceOrientations~ipad`), and the one-shot read never updated on rotation, so the
  viewfinder kept its portrait geometry after turning the device. The hook had to move ABOVE the
  `if (!visible) return null` early return.
- `BOTTOM_CONTROLS_MIN_HEIGHT` (200) is measured from the styles it protects — zoom pills (36 + 24),
  shutter row (76 + 5), section padding (12 + 12 + 20). Keep the two in step.

## Public Sans is now the app-wide default, so Android's device font can't win

Ticket: *"some of the fonts on android are the android default font, not public sans … make sure all
fonts are connected and are public sans … make sure public sans will show even though we change the
font from over android device setting."*

**The fonts were never missing.** All nine upright faces are bundled and registered on both platforms
(`src/assets/fonts` + `react-native.config.js`; `UIAppFonts`; `android/app/src/main/assets/fonts`). The
gap is that a `<Text>` only gets Public Sans when something **names a face** — the NativeWind `font-*`
classes do (`tailwind.config.js` maps every one of them to a `PublicSans-*` file, ~1,450 sites) and the
**~850 inline `style={{ fontWeight: '700' }}` sites do not**. With no `fontFamily` each platform falls
back to its own system font: on Android that is **whatever the user picked in the device font setting**.

**Pure `src/utils/default-font.ts`** (`resolveFontPatch`) decides the face; it is applied from the
`ScaledText` / `ScaledTextInput` wrappers in **`index.js`** — the same wrappers that do tablet font
scaling, and which already patch the `react-native` exports, so text inside third-party components
(navigation headers, chat, pickers) is covered too rather than 201 files being edited.

⚠️ **The util is INERT without that `index.js` wiring**, and it has already been lost once: `a96b3ac`
committed `default-font.ts` alone, leaving nothing that imports it — which reads on device exactly like
the original bug. If unclassed text is following the device font again, check `index.js` FIRST.

### ⚠️ Naming a face is NOT enough on Android — the WEIGHT has to go with it

`ReactFontManager.createAssetTypeface` resolves a family + weight by looking for the FILE
`fonts/<family><variant>.ttf`. So `PublicSans-Regular` + `fontWeight: '700'` looks for
**`PublicSans-Regular_bold.ttf`**, misses, and falls through to
`Typeface.create("PublicSans-Regular", BOLD)` — an unknown family — so Android returns the **system
font, synthetically bolded**. Silent, and indistinguishable from the missing-font bug.

Every patch is therefore a PAIR — the face **plus `fontWeight: 'normal'`**:

| | why the pair works |
|---|---|
| Android | `TypefaceStyle.nearestStyle` stays NORMAL (or ITALIC), so the exact `.ttf` is loaded |
| iOS | `RCTFontUtils` reads the name, recovers its real family, then `fontWeight = (fontWeight != 0.0) ?: RCTGetFontWeight(font)` — and `normal` **IS** `UIFontWeightRegular`, which is literally `0.0`, so the named face's own weight wins |

⚠️ This is the exact pair `tailwind.config.js` has always emitted (every `fontWeight` value there is
remapped to `'normal'`) — so it is not a new rendering path, just one applied to the styles that had
none. Do not "tidy" those `'normal'`s away in either place.

### What it deliberately leaves alone

- ⚠️ **Any font that is not ours** — `Ionicons`, `MaterialCommunityIcons`, … Every icon in the app is a
  `<Text>` with an icon `fontFamily`; rewriting those to Public Sans would replace every icon with a
  missing glyph. Tested.
- ⚠️ **`fontWeight: 'normal'` / `400` beside a face that is already ours.** That value is usually not an
  author's opinion — Tailwind emits it mechanically next to every `font-*` family class — so honouring
  it would turn **every `font-bold` in the app back into a regular face**. A heavier explicit weight
  DOES win, because that is a real instruction and it is also the Android trap above
  (`font-sans` + `fontWeight: '700'`), where iOS already resolves Public Sans Bold and Android does not.

⚠️ **iOS changes too, and that is the point.** Unstyled text there was San Francisco; it is now Public
Sans, so the two platforms finally agree and match the design system. Scope it to Android with a
`Platform.OS` test in `index.js` if that is ever unwanted — but then the platforms diverge again, which
was the complaint one ticket earlier.

⚠️ **Not covered, by nature:** `Animated.Text` (one site, `CustomCameraModal`'s zoom label — RN's
`Animated` namespace wraps the internal Text module, not the patched export), and anything the OS draws
itself (`Alert`, native date pickers, WebView/PDF content).

⚠️ **Font SIZE is untouched.** The device's text-size setting still scales the app (`allowFontScaling`
stays on) — that is accessibility, and this ticket is about the typeface.

### …and the follow-up: the last Text still following the device font was ITALIC

Ticket, with an Android screenshot whose system font was a script face: *"this text should be change if
we change the font from the android settings"* — pointing at `Leads/index.tsx`'s
`className="text-[10px] italic"` caption (*All Self Gen Leads will be archived end of day unless
deleted*), rendering in that script font while everything around it was Public Sans.

Italic was the one case the first pass skipped, because no italic face was bundled. **Fixed by shipping
the missing faces** rather than by dropping the slant: `PublicSans-Regular_italic.ttf` and
`PublicSans-Bold_italic.ttf`, taken from the official OFL source (`uswds/public-sans`) and verified to
carry the same `Public Sans` family name (and the italic bit, at weights 400/700) as the nine upright
faces — which is what lets iOS find them, since it matches on family + the italic trait, never on the
file name.

⚠️ **Dropping `italic` was NOT an option**, and this is worth knowing before anyone "simplifies" it:
`LeadCenter/DraggableText.tsx` lets the rep CHOOSE Italic / Bold Italic on an annotation, and
`agreement/blocks/SignatureSectionBlock.tsx` uses italic as the stand-in for web's cursive signature
font. Forcing those upright would have broken two features to fix a caption.

⚠️ **An italic style may name ONLY those two families**, and the file NAMES are load-bearing. Android
looks for `fonts/<family>_italic.ttf`, so the files are named after the family the resolver asks for —
not after the fonts' own `PublicSans-Italic` / `PublicSans-BoldItalic` PostScript names. Adding
`PublicSans-SemiBold` to `ITALIC_FACE` selection without shipping `PublicSans-SemiBold_italic.ttf`
sends that text **straight back to the device font**, silently. A heavier italic therefore renders Bold
Italic rather than Black Italic.

⚠️ And it is the `fontWeight: 'normal'` half of the pair that keeps `nearestStyle` at **`ITALIC`** rather
than `BOLD_ITALIC` — without it Android would look for `PublicSans-Bold_bold_italic.ttf` and miss.

⚠️ Linked by hand rather than by re-running `react-native-asset`: two `UIAppFonts` entries plus the four
`project.pbxproj` entries each font needs (`PBXBuildFile`, `PBXFileReference`, the group's children, and
the Resources phase), modelled on the existing `PublicSans-Light.ttf` rows. Both files pass
`plutil -lint`. **iOS needs a rebuild for the new resources to reach the bundle.**

⚠️ **`ios/revDSM_Sales/Info.plist` and `project.pbxproj` are CRLF** — editing them in text mode rewrote
every line to LF and turned a 10-line change into a 262-line one. Use `newline=''`. (Same trap already
recorded here for `dynamic-deal-diff.ts` and `EditCustomerModal.tsx`.)

⚠️ Needs a device check (this repo cannot render-test): set a custom system font on Android and confirm
the app ignores it, italics included; and watch the tight inputs — Public Sans has different
ascent/descent than SF, so the Leads search field (whose descender clipping was tuned in an earlier
ticket) is where a metric shift would show first.

## Hold-to-peek previews warm through a shared local-file cache

Ticket: *"Render hold-preview takes 2–3s blank"* — first reported on the RevRender rollout slots,
then again by QA on **Manage Photos**, **revRender ▸ Select a photo** and **Configure Render**.

Cause is the `Image.prefetch` gotcha above: holding a thumbnail opens an enlarged preview, whose
full-size decode misses the OS cache and re-downloads the S3 object, so the peek sits blank.

- **`src/utils/imageFileCache.ts` (new)** — the cache primitives (`getLocalCachePath`,
  `downloadImage`, `prefetchToLocalCache`) **moved here** from
  `widgets/modals/lead-center/RevRenderHistoryModal.tsx`, which now imports and **re-exports**
  `getLocalCachePath` / `prefetchToLocalCache` so its existing callers (`RevRenderSlots`,
  `OperationalSections`) are unaffected. The move exists so a leaf widget can warm images without
  importing a heavy modal screen. Added: **`isRemoteImageUrl`** (only http(s) is worth caching) and
  **`warmToLocalCache(url)`** → resolves the `file://` uri, or `null` so callers fall back to the
  network url.
- **Concurrency is capped at 3** (`MAX_CONCURRENT_WARMS` + a small semaphore). A photo grid can
  mount 20+ thumbnails at once (Manage Photos ▸ Roofline is 0/22); warming them all in parallel
  would saturate the connection and make the *visible* thumbnails slower — the opposite of the goal.
- **Warming lives in `PhotoPeekPressable` itself** (`usePeekCachedUri`), NOT in each screen, so every
  consumer gets it and no new one can forget it — that is what fixes all three screens QA reported
  at once. The preview renders `cachedUri || uri`, so it is never worse than before, and the
  `Animated.Image` is **keyed on the uri** so swapping network→file remounts instead of leaving the
  stale decode up.
- `RevRenderSlots.tsx` keeps its own bespoke warm block. It is now **redundant** (the download layer
  dedupes by cache path, so there is no double fetch) but harmless — it warms slightly earlier, at
  list mount rather than thumbnail mount. `RevRender/index.tsx`'s `Image.prefetch` block is left
  alone too: it targets the `HouseImage` thumbnails, not the peek.

## Order-sheet / agreement upload took ~18 s — multi-MB base64 was being CONSOLE-LOGGED

Ticket: *"Sales rep - Order sheet takes like 18 seconds to show it's uploaded… i checked the api
responses which are taking almost 3 to 4 sec, can you check i think there is something else issue."*
Correct diagnosis — the network was ~3–4 s of the 18 s. The rest was the JS thread, and most of it was
**logging**.

A scanned page becomes a base64 PDF (`convertJpegToPdf`) and is PUT as
`[rootKey][i].file`. For a normal phone photo that string is **~3.4 MB**. Two separate places then
logged it *in full*:

- **`DynamicJobBuilderScreen.handleUploadDocs`** — `JSON.stringify(docSubmitPayload, null, 2)`,
  pretty-printed, base64 included. ⚠️ Its two neighbours in the SAME file (`[COMPLETE JOB PAYLOAD]`,
  `[COMPLETE JOB — OUTCOME MIRROR PAYLOAD]`) already elide the bodies, with the comment *"stringifying
  multi-MB base64 for a log line is exactly the kind of heap spike that used to crash Submit"* — this
  one was simply **missed**. Now elided to `<base64 N chars>` the same way (measured: the logged string
  goes from **3.4 MB to 205 chars**).
- **`services/api/index.ts` › `logTraffic`** — the dev-only axios interceptors logged `config.data` and
  `res.data` verbatim, so the same 3.4 MB went to the console a **second** time on the request, and the
  document-download responses (which carry `base64Data` per row) went again on the way back. New
  **`sanitizeForLog`** replaces any string over 512 chars with `<string N chars>`, caps arrays at 20 and
  depth at 6. It only reads `.length`, so the big strings are never copied or scanned.

⚠️ **The cost is `console.log`, not `JSON.stringify`.** Building the 3.4 MB string is ~16 ms on V8;
what hurts is pushing it to the console — and with **React Native DevTools attached** (as in the
reporter's screenshots) every logged string is serialised across the **CDP websocket**. That is the
multi-second, invisible cost. Never log a document payload, a response containing `base64Data`, or any
request body that can carry a file.

**Still outstanding — `convertJpegToPdf` (`utils/jpeg-to-pdf.ts`) is pure-JS base64 on the JS thread.**
It `base64.decode`s the whole JPEG into a binary string, concatenates it with the PDF objects, and
`base64.encode`s the multi-MB result back — via the pure-JS `base-64` package, which loops per
character. Measured on V8/laptop: **~580 ms for a 2.5 MB JPEG** (decode 385 ms + encode 197 ms); Hermes
on-device is several times slower, and it **blocks the UI** — `handleScannerSave` only calls
`setScannerCategory(null)` *after* the upload resolves, so the scan sheet sits frozen throughout.

The fix is to assemble the PDF **natively** with `react-native-blob-util` file appends
(`writeFile(header,'utf8')` → `appendFile(jpegBase64,'base64')` → `appendFile(footer,'utf8')` →
`readFile('base64')`), which needs no base64 work in JS at all and has no chunk-alignment concern
because each append decodes its own chunk to bytes. ⚠️ **Not done yet because it makes the function
async**, and `document-payloads.ts › storedRowToPayload` is **sync**, plus there are three duplicated
local copies of `convertJpegToPdf` (`screens/JobBuilder/index.tsx`,
`widgets/components/job-builder/SummarySection.tsx`,
`widgets/components/LeadCenter/JobDocsSection.tsx`) — a 4-file change on the legal-document path, which
should not ride along with a logging fix.

⚠️ Do **not** "fix" this by pre-compressing the scan without asking: these are contract documents and
image quality is a business decision, not a perf knob.

## `FlashMessage.show()` rendered a TRANSPARENT banner for every non-danger type

Ticket: *"when i click on edit splash message is not visible, looking like it's picking the header
color"* — the Lead Center "Edit on web" notice (`FlashMessage.show(..., 'info')` for a legacy deal)
appeared as white text painted straight onto the dark green `MainHeader`, with no banner behind it.

The bug is in the shared wrapper **`src/config/message.ts`**, not at the call site. `show()` built its
style as:

```ts
style: { zIndex: 9999, elevation: 9999, backgroundColor: type === 'danger' ? '#D32F2F' : undefined }
```

`react-native-flash-message` resolves the type colour into its own style array and then applies **our
`style` last** (`node_modules/react-native-flash-message/src/FlashMessage.js` ~line 224), and RN's
style flatten lets a **present-but-`undefined`** key win over an earlier value. So for `info` /
`success` / `warning` the explicit `undefined` **wiped `ColorTheme[type]`** and the banner rendered
with no background at all. Verified directly: flattening `[{backgroundColor:'#2196F3'}, {…,
backgroundColor: undefined}]` yields `undefined`; dropping the key yields `#2196F3`.

Fixed by **spreading the key in only when it has a value** —
`...(type === 'danger' ? { backgroundColor: '#D32F2F' } : null)`.

⚠️ **Never write a conditional style value as `x ? v : undefined` in an object handed to a library that
merges it last.** The ternary reads as "leave it alone" and does the opposite. Spread the whole key or
omit it.

This fixed **all three** non-danger `show()` call sites at once — `LeadCenter` (Edit on web),
`DealDetail` (same notice) and `AppointmentSchedulerModal` ("Amendment requires customer signature") —
which is why the wrapper was fixed rather than the reported call site. `FlashMessage.success` /
`warning` / `info` / `error` were never affected: they either don't set the key or set a real value, so
`FlashMessage.info(...)` was always the working path.

## The repo guide now updates itself: a `doc-guard` hook routes each change to its part file

Ticket: *"automatically add the command result according to the command md — if the user works on
Installer then the installer file updates, if the user works in Deal Center then update that."* The
standing rule (write every ticket up in `docs/claude/<area>.md`) lived only in the guide and in
Claude's memory, so it held exactly as long as the model remembered it mid-task.

It is now enforced by a Claude Code hook — **`.claude/hooks/doc-guard.js`**, wired in the tracked
`.claude/settings.json`:

- **`PostToolUse`** (`Edit|Write|MultiEdit|NotebookEdit`) → after the first edit to a given area it
  injects "`src/screens/Installer/index.tsx` is covered by `docs/claude/installer.md`", which also
  prompts the *read-before-changing* half of the rule. Once per part per session, so it cannot spam
  the context.
- **`Stop`** → refuses to end the turn while a **code file changed this session is newer than every
  part file that covers it**, listing the files under the part that owes the note.

**Routing is parsed from the §8 table in the root `CLAUDE.md`** — the backticked globs in its "Read
before changing" column — so the table stays the single source of truth and a new area is routed by
adding a row, never by editing the hook. Matching rules: `**` is any depth, `*` stays within a
segment, and a **named file outranks a directory glob** (weight `1000 + literal length`), which is
how `DynamicDealEditScreen.tsx` resolves to `deal-edit-addendums.md` even though
`screens/DynamicDealCenter/**` also contains it. A bare name that exists at the repo root (`index.js`)
anchors there rather than matching every `index.js` under `src/`. §8's rows were widened from screens
and utils to the matching hooks so routing covers ~356 of 505 source files; anything unmatched is
reported as "no §8 row covers this — use the closest part and add the path to that row", so the table
fills itself in over time.

⚠️ **Staleness is judged from the working tree (`git status` + mtimes), not from tool calls.** Edits
made by a Bash/python script — the CRLF-safe path used all over this repo — would be invisible to a
tool-call tracker but are caught here. The trade-off is that mtimes, not content, decide: touching a
part file satisfies the guard.

Three things keep it from becoming a nuisance, and all three are deliberate:

- `stop_hook_active` is honoured — a turn the guard has already blocked once is allowed to end, which
  is what prevents an infinite stop loop.
- Each distinct set of undocumented files is raised **once** (fingerprinted in a per-session state file
  under the OS temp dir), so a change Claude judged not worth a note is not re-raised every turn.
- Only changes newer than the session's transcript file count, so a colleague's pre-existing
  uncommitted work is never something this session is asked to write up.

⚠️ **Every failure path exits 0 silently** (bad JSON, no git, no `docs/claude/`, a parse error) — a
broken guard must never block real work. Scope is `src/**` plus root `index.js` / `App.tsx`, and only
`.ts/.tsx/.js/.jsx`: assets and the gitignored `__tests__/` are not "a change". Deletions carry no
mtime and are skipped — removing a file is the one edit the guard cannot see.

⚠️ **Hooks are snapshotted at session start.** Editing `settings.json` does not arm them in the session
that made the edit; the next session (or a review in `/hooks`) picks them up. Written in plain
CommonJS Node with no dependencies because the team runs Claude Code on both macOS and Windows.

## `focusManager` is wired to `AppState` (React Query revalidates on foreground)

`services/api/queryClient.ts` now calls `focusManager.setFocused(status === 'active')` from an
`AppState` listener.

Why it was needed: React Query's "window focus" is a browser concept, and on React Native nothing drives
it unless `focusManager` is told about `AppState`. So `refetchOnWindowFocus` was **inert app-wide** — a
query that set it got no foreground revalidation at all. That is half of why portal-authored job-builder
config edits never reached a running app (full write-up: `deal-center.md`).

⚠️ **This only ENABLES the behaviour.** The client default stays `refetchOnWindowFocus: false`, so a
query revalidates on foreground only if it opts in explicitly. Today exactly one does:
`['jobBuilderProductsConfig']` in `useDynamicCalculatorSchemas`.

⚠️ **Setting `refetchOnWindowFocus: true` on a query now actually does something.** Before this it was a
no-op, so any query already carrying it starts refetching on every foreground — check before adding it
to a heavy or paginated query.

⚠️ The listener is module-scope, registered once when `queryClient.ts` is first imported, and
deliberately never removed — the client lives for the process.
