# App-wide platform notes (fonts, iPad, images, logging, flash messages)

> Part of the repo guide — the index is the root `CLAUDE.md`. **Read this before changing:** `index.js`, `utils/default-font.ts`, `utils/keyboard-type.ts`, `utils/imageFileCache.ts`, `hooks/useWarmedImageUris.ts`, `widgets/common/PhotoPeekPressable.tsx`, `widgets/modals/CustomCameraModal.tsx`, `services/api/index.ts`, `utils/sanitize-for-log.ts`, `config/message.ts`.
>
> Each `##` section is one ticket: the ask, the root cause, the decision, and the ⚠️ traps that must not be
> "fixed" back. Newest follow-ups sit under their original ticket. Add new notes for this area HERE, not in the root file.

## iPad: numeric fields get a DOCKED keyboard, not iPadOS's floating palette

> ⚠️ **STILL IN FORCE ON iOS/iPad.** The custom number pad is ANDROID-ONLY (see "Custom in-app number pad" below), so iOS and iPad keep the system keyboard and this whole section - `NUMERIC_KEYBOARD` / `NUMBER_PAD_KEYBOARD` resolving to `numbers-and-punctuation` on iPad, and `NUMERIC_KEYBOARD_HAS_RETURN_KEY` - applies exactly as written. `utils/keyboard-type.ts` was restored to its pre-pad form for that reason.

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

## A flash raised from inside a `Modal` rendered BEHIND it — banners now route to an in-sheet host

Ticket: *"on the funding side we are getting the error from the backend and the error is hitting, but
the error displays below the sheet — fix this, the error should display in front."* A `PUT
/lead/v1/:id/funding` answered `422 "Down payments total $600, above the 50% maximum ($550)"`, the
network tab showed it, `useFunding.report` flashed it — and the rep saw nothing.

**Root cause: the app's only `<FlashMessage />` lives in `App.tsx`, and a native `Modal` is its own
view tree.** Every banner raised while a sheet is open was drawn into the window UNDERNEATH it, behind
that sheet's scrim/blur. The `zIndex: 9999` / `elevation: 9999` the wrapper already sets cannot reach
it — those order siblings within one tree, and the modal is a separate window.

`src/config/message.ts` now carries a **host stack**:

```ts
export interface FlashHost { show: (options: MessageOptions) => boolean }
export function registerFlashHost(host: FlashHost): () => void   // returns the unregister
```

and every wrapper method raises through one internal `emit()` — topmost host that accepts it, else the
app-root instance. **`src/widgets/common/ModalFlashHost.tsx`** is the other half: a `<RNFlashMessage>`
mounted as the last child of a modal's root view, registered for as long as it is open.

```tsx
<Modal ...>
  <KeyboardAvoidingView style={{ flex: 1 }}>
    {/* the sheet */}
    <ModalFlashHost active={visible} />
  </KeyboardAvoidingView>
</Modal>
```

**Nothing changes at the call site** — and that is the point. `FlashMessage.error(...)` inside
`useFunding` has no idea which sheet is on screen, yet its banner now lands inside it.

⚠️ **The fallback in `emit()` is not optional.** A host whose ref has not attached yet, or whose modal
is mid-dismissal, answers `false` and the banner goes to the root instance. Swallowing it there would
be worse than the bug being fixed: a refusal nobody ever sees.

⚠️ **`canRegisterAsDefault={false}` on the in-modal instance.** Without it the component asks
`FlashMessageManager` to become the process-wide default for the library's own `showMessage()`. It is
a no-op *today* (the manager keeps the FIRST registrant, which is App.tsx's), but it would hijack every
global banner in the app the moment mount order changed. Our routing is the registry, never that manager.

⚠️ **A STACK, not a single slot, and unregister removes by IDENTITY.** Sheets nest, and React does not
guarantee unmount order — popping would leave a dead host on top and send banners into an unmounted tree.

⚠️ **`ModalFlashHost` deliberately does not read `useSafeAreaInsets()`.** Insets read 0 or stale inside
a `Modal` (root guide), and the library derives the status-bar offset itself in `FlashMessageWrapper`
from the options `config/message.ts` already sends — so a banner does not jump when a sheet opens.

⚠️ **Not a fix for `RNFlashMessage` instances a modal already owns.** `ConsentFormModal`,
`RoofWaiverModal`, `OutcomeModal`, `InspectionFormModal`, `LeadCreate` and `useRoofWaiver` each
hand-roll a local instance with their own `flashRef` wrapper; they keep working untouched. New sheets
should use `ModalFlashHost` instead of copying that block — it is the same fix without the duplicated
wrapper, and it also catches banners raised by hooks rather than by the component.

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

### Merge note: `onlineManager` and `focusManager` are BOTH wired, independently

When `dev-v1-multi-tenat` merged into the offline branch, `queryClient.ts` conflicted: the offline work
had added the `onlineManager` wiring (+ `networkMode: 'offlineFirst'`, `refetchOnReconnect`) and the
other branch had added the `focusManager` wiring, both at the top of the same file. **The resolution is
the union — neither replaces the other.**

They answer different questions and React Query gates a refetch on BOTH:

| Manager | Question | Fed by |
|---|---|---|
| `onlineManager` | Is there a link? | `subscribeConnectivity` (`services/connectivity.ts`) |
| `focusManager` | Is the app in front of the rep? | `AppState` `change` |

⚠️ **Deleting either one silently disables refetching the other appears to provide.** Drop
`focusManager` and the config never revalidates on foreground however good the signal; drop
`onlineManager` and nothing resumes on reconnect. A future conflict here must keep both blocks.

⚠️ **`offlineFirst` does NOT defeat the focus refetch.** It defers only the RETRIES, so a query
returning to the foreground still issues its first request. The two settings are compatible; this was
checked when resolving, because it is the non-obvious way the union could have been wrong.
## `MapToggleSwitch` gained per-instance colours — its ON state was hardcoded green for every caller

Ticket (Sales Map): *"all the toggles [look] the same, make it different for pending install and
installed."* `widgets/common/MapToggleSwitch.tsx` is the small vertical switch behind every quick-filter
toggle on the Sales Map (heatmap, my jobs, referral, favorite, and two new pin-status ones — full ticket
in `maps-zone-canvasser.md` › "the two new toggles were both the switch's default green"). Every instance
turned the identical green (`#4CBB17`) when ON, because the ON colour was a literal inside the component,
not a prop — six switches with six different meanings all looked the same active.

Three new **optional** props, each defaulting to the ORIGINAL hardcoded literal so every existing caller
renders byte-identical to before:

- `activeColor` (default `'#4CBB17'`) — the track colour when ON.
- `activeDotColor` (default `'#4ade80'`) — the inner thumb-dot colour when ON.
- `activeLabelColor` (default `'white'`) — the ON-state label text colour.

⚠️ **The idle (OFF) track outline is now DERIVED from `activeColor`** — `` `${activeColor}33` `` — rather
than a second hardcoded literal. For the default green this reproduces the original `#4CBB1733` exactly;
a caller with a custom `activeColor` gets a matching faint outline while off for free, with no second
prop to keep in sync.

⚠️ **`activeLabelColor` exists because the naive fix would have shipped an accessibility bug.** The
default label colour is white, which is illegible on a bright/light `activeColor` (the Sales Map's new
pending-install yellow, `#FFD400`). Any caller passing a light `activeColor` must also pass a dark
`activeLabelColor` — don't rely on the default.

⚠️ **Pick `activeColor` from whatever colour SYSTEM the toggle represents, never a hand-picked hex.** The
Sales Map instances pass `PIN_CATEGORY_META.<category>.color` — the exact same constant already driving
that category's pin and legend dot — specifically so a toggle, its pin, and its legend row can never
drift into three slightly-different colours across separate tickets.

No behaviour change for the four pre-existing callers (heatmap / my jobs / referral / favorite) — they
pass no colour props and get the defaults, which are the old literals verbatim.

## `CustomInput`: `fontSize` and `flushLabel` props

`widgets/common/CustomInput.tsx` defaults to 12pt text and a label indented 4pt (`ml-1`). Both new props are opt-in, so
existing screens are unchanged: `fontSize` is applied in render AND in the `setNativeProps` effect (which otherwise reset
size to 12), and `flushLabel` drops the indent. Used by the Add New Lead form.

### Merge note: `queryClient.ts` carries BOTH the focus and the online listeners

`dev-qs-offline` added `onlineManager.setEventListener` (fed by `services/connectivity`) and this branch had `focusManager` wired to `AppState`; they are independent, so the merged file keeps both at module scope above `new QueryClient`. ⚠️ Don't drop either: without the focus listener `refetchOnWindowFocus` opt-ins never fire on foreground, and without the online listener retries run against a dead link and nothing refetches on reconnect. The `offlineFirst` network mode and `refetchOnReconnect: true` defaults came from the offline branch and stay.

## `index.js`: Android upload-service runner registered at module scope

`index.js` now calls `registerAndroidUploadRunner()` (`src/services/background/androidUploadService.ts`) right after the FCM
background handler. It tells notifee what the Android foreground service DOES — run the coordinator drain
(`uploadCoordinator.runBackgroundDrain`) — so queued photos and leads keep uploading after the app leaves the screen. Full
design, platform limits and the device test matrix are in **`docs/claude/offline.md`** (§ Background upload service).

- ⚠️ **Module scope, before `AppRegistry.registerComponent`** — same rule as the FCM handler above it. notifee looks the
  runner up when the service starts, and a process restarted headless has no React tree to register it from.
- ⚠️ **Lazily required inside try/catch**, not imported at the top. notifee resolves its native module at import time and a JS
  reload against a stale binary would otherwise take the whole bundle down.
- A no-op on iOS, which uses `ios/revDSM_Sales/BackgroundUploadTask.m` (`beginBackgroundTask`) instead.

---

## RevRender lighting picker — no outer glow on tiles

Ticket: picker tiles (presets, Recently Rendered, Teams) must show solid pucks with no outer glow.
- `LightStrip` gained a `glow` prop (default `true`); `LookTile` passes `glow={false}`, which skips the three
  translucent halos. Pucks stay at their normal size.
- ⚠️ The selected-renders list in `LightingPanel` and the RevRender history row still glow (the ticket's
  "preview cards should match" was optional). Pass `glow={false}` there too if the client wants parity.

## RevRender gallery — lighting renders show their look

Ticket: a Roofline Lighting render must say what was rendered ("Christmas" + colour dots), the way core
renders show "Soffit: <colour>" chips under the header.
- `RevRenderHistoryModal.renderColors` has a first branch for runs carrying `selections.lookName` (or
  `run.lookName`): one chip, the look name plus one dot per entry of `selections.colors`. Core-product runs
  take the old branches unchanged.
- ⚠️ The field names mirror the request payload (`toLookPayload`); not verified against a real history response.
  If the chip is missing on a lighting render, log the run and check where the server echoes `selections`.

## Custom in-app number pad (Lead Create pilot)

Ticket: client wants a custom keyboard for digit-only fields (instead of the device/Android IME), shown only
when such a field is tapped, never covering half the screen. **Pilot: Lead Create only**; the rest of the app
is untouched until we roll it out.

- **`utils/numpad.ts`** (pure, tested in `__tests__/utils/numpad.test.ts`): `numPadModeFor(keyboardType, override)`
  decides pad vs system keyboard from the type the field already declares (`number-pad`/`phone-pad` → digits,
  `numeric`/`decimal-pad` → decimal, everything else → `null` = system keyboard); `applyNumPadKey` is the edit rule.
- **`widgets/common/keyboard/NumPad`**: `NumPadProvider` + `useNumPad`. **`CustomInput` does the detection**: under a
  provider, a numeric field sets `showSoftInputOnFocus={false}` and attaches itself to the pad on focus / detaches on blur.
  Outside a provider nothing changes - **rolling out = wrap another screen/modal in `NumPadProvider`**.
- The pad is an **in-flow sibling under the ScrollView, not an overlay**, so the form shrinks instead of being covered;
  key height is derived so the pad stays ~1/3 of the window (`useWindowDimensions`, so landscape/iPad are covered).
- ⚠️ **The provider must sit INSIDE the `Modal`** (own native tree) and BELOW the form's ScrollView in the same column.
- ⚠️ **Edits always happen at the END of the text.** Fields reformat as you type (phone `+1 (XXX) XXX-XXXX`), so a
  mid-string caret is meaningless. Backspace in `digits` mode also eats trailing punctuation, or `+1 (123) ` would
  reformat straight back to itself and the key would look dead.
- ⚠️ **Text -> numpad field switch**: the system keyboard is still up, so `attach` calls
  `KeyboardController.dismiss({ keepFocus: true })`. A plain `Keyboard.dismiss()` would blur the field just focused.
- ⚠️ **iPad can't tell `number-pad` from `numeric`** (both resolve to `numbers-and-punctuation`, see the iPad ticket
  above): pass `numPad="decimal"` on a decimal field. `numPad={false}` opts a field out.
- ⚠️ `insets.bottom` reads 0/stale inside a Modal - the pad floors its bottom padding.
- Not verified on device from this session: check Android (IME really hidden when tapping from Email to Phone) and the
  iOS QuickType bar not appearing over the pad.
- ⚠️ **Never `Pressable style={({pressed}) => ...}` here** - NativeWind drops the function form and the keys collapsed to bare text. Plain style object + `useState` (see `Key`). Look: 4-column pill grid, 3-column grid; bottom row = backspace / 0 / green check (Done), all the SAME pill size - a tall oval Done key looked wrong. Decimal fields get a `.` key and Done drops to its own row.
- ⚠️ **SUPERSEDED (see "Lead Create: invisible keyboard gap" below): Lead Create no longer disables its `KeyboardAvoidingView` while the pad is up.** Old note: `GlobalKeyboardAvoidingView` takes `enabled`; Lead Create turned it off while the pad is up (`NumPadProvider onActiveChange`). iOS still reports the hidden system keyboard's height, which left a white gap under the pad.
- ⚠️ **Android re-raise guard**: while a pad owns focus, `keyboardDidShow` triggers `KeyboardController.dismiss({ keepFocus: true })` (Android only - on iOS it would resign the field).
- **Slide animation**: `NumPadPanel` animates `height` (so the form above resizes smoothly) + `translateY` over ~220ms, JS driver (height can't be native). ⚠️ The provider keeps the last target in `shown` so the pad can finish sliding OUT before it unmounts; `open` flips first, `onClosed` unmounts. Height is computed (`rows * (key+gap)`), not measured - change both together if the key rows change.

### App-wide rollout (all numeric inputs, no per-file edits)

Ticket: *"make the custom num pad global - every digit field in the app, restrict the device keyboard, keep the app smooth."*

**Wiring (4 places, then nothing per screen):**
- `index.js` - the existing global `ScaledTextInput` calls `useNumPadField(props)` (`widgets/common/keyboard/NumPad/useNumPadField.ts`): a numeric `keyboardType` => `showSoftInputOnFocus={false}` + attach/detach the pad. Text/email/etc. are untouched. The `numPad` prop (`'decimal' | 'digits' | false`) is ours and is stripped before the native view.
- `index.js` - `rn.Modal` is patched to a wrapper that mounts a `NumPadProvider` INSIDE every modal. ⚠️ **Not optional**: a Modal is its own native tree, so a pad drawn by the root provider would sit hidden behind the modal while the field's system keyboard is suppressed - the rep could not type. Never render a field in a native tree that has no provider above it.
- `App.tsx` - one root `NumPadProvider` around `NavigationContainer` for every screen.
- `LeadCreate` keeps its own `mode="inflow"` provider (pad in the column, form shrinks) - the nearest provider wins.

**`mode="pan"` (default)** is layout-agnostic: the pad is an absolute overlay and the host slides its content up by `panShiftFor(...)` so the focused field clears it. It needs no knowledge of each screen's layout, and both animations run on the NATIVE driver (no layout pass per frame), which is what keeps 25+ screens lag-free.
- ⚠️ `PanHost` measures host + content + input with `measureInWindow` and subtracts, so iOS/Android disagreeing on whether the current transform is included can't compound the shift when focus moves A -> B.
- ⚠️ `animateTo` no-ops when the shift is unchanged - every Modal in the app mounts a host, so an unconditional animation would start on each modal open.
- Cost per input: one `useContext` + refs. The context value is stable, so inputs do NOT re-render when the pad opens. Provider re-renders reuse the same `children` element, so the screen below is not re-rendered either.

**Behaviours worth knowing:**
- **Done (check) fires `onSubmitEditing` and then blurs**, on every platform. Fields that commit on submit now get it on iPhone too; a blur-commit on top would double-commit (`NUMERIC_KEYBOARD_HAS_RETURN_KEY` is `true` for that reason - `RolloutView`'s drop price no longer commits on tap-away on iPhone, same as Android already did).
- **Backspace on an already-empty field calls `onKeyPress({key:'Backspace'})`** - the OTP boxes step back with it, so OTP works on the pad with no special case.
- Uncontrolled inputs (no `value`) are supported: the pad tracks the text and writes it with `setNativeProps`.
- Focus A -> B waits `DETACH_GRACE_MS` before closing so the pad doesn't slide out and back in.
- `GlobalKeyboardAvoidingView` stands down while a pad is up (`useNumPadActive`). Raw RN `KeyboardAvoidingView`s (31 files) are NOT patched: on Android there is no keyboard event at all.
- Digits and `.` only: a numeric field that must accept a minus sign or `+` needs `numPad={false}`.
- ⚠️ **Not verified on device from this session** (JS/unit checks only): iOS - confirm no gap/double-shift from a raw `KeyboardAvoidingView` when the hidden system keyboard reports a height, and that the QuickType bar doesn't show; both platforms - walk the rollout drop price, Calculator Summary, Profile, Edit Customer, OTP boxes.
- Files touched by the app-wide rollout: `index.js` (TextInput + Modal patches), `utils/keyboard-type.ts` (platform split removed), `widgets/common/CustomInput.tsx` (only gained the `numPad` prop type; the logic lives in `useNumPadField`, never duplicate it there or a field attaches twice), `widgets/common/keyboard/GlobalKeyboard/index.tsx` (`useNumPadActive`).
- ⚠️ **Default is now `mode="inflow"`, NOT pan** (follow-up): pan slid the WHOLE screen up - header included - to clear the field (Job Builder lost its top bar and the Next footer sat under the pad). In flow, the pad takes its own strip and the screen shrinks like the system keyboard did; header/footer never move. The space is reserved at once and only the pad slides (native driver); `layoutAnimated` (Lead Create only) also tweens the height. `fill` wraps children+pad in a `flex: 1` View - used by the root and the Modal wrapper, ⚠️ NOT by Lead Create, whose parent is content-sized (`maxHeight`) where a flex child collapses. Known cost: a screen whose own footer adds `insets.bottom` shows that gap above the pad. `mode="pan"` stays available but nothing uses it.
- Files for the in-flow default: `index.js` (Modal wrapper mounts `<NumPadProvider fill>`) and `widgets/common/keyboard/NumPad/index.tsx` (`mode` default `inflow`, `fill`, `layoutAnimated`, panel reserves its space at once). Already described above - this line only lists the touched files.

### Android only (decision)

*"Use the custom keyboard only on Android; iOS keeps the system keyboard."*

- `NumPadProvider` (`widgets/common/keyboard/NumPad/index.tsx`) is a **pure pass-through on iOS/iPad** - no host View, no state - and `useNumPadField` returns `null` unless `Platform.OS === 'android'`, so a numeric `TextInput` on iOS is exactly what it was before the pad existed. The root provider and the patched `Modal` therefore cost iOS nothing.
- ⚠️ **Keep the two platform checks in step** (`NumPadProvider` and `useNumPadField`). If only the hook stayed Android-gated, iOS would still mount hosts; if only the provider were, iOS fields would suppress their system keyboard with no pad to type on - **a field the rep cannot type into**.
- ⚠️ **`utils/keyboard-type.ts` is back to its original** (iPad -> `numbers-and-punctuation`, `NUMERIC_KEYBOARD_HAS_RETURN_KEY = IS_IPAD || android`), because iOS needs it again. On Android the constants are plain `numeric` / `number-pad` (distinct, which is what the pad reads), and the return-key flag is `true`, so the Done check commits exactly once - `RolloutView`'s blur commit stays disarmed there and armed on iPhone only, as before.
- The Android-specific traps above (Done submits then blurs, Android `keyboardDidShow` guard, in-flow default, `fill`) are unchanged; the iOS-only notes in them (QuickType bar, stale keyboard height) no longer apply.

### Number pad: `useNumPadTarget` + `useNumPadScrollIntoView` (focused field hidden under the pad)

Ticket: *job-builder field half hidden by the number pad.* The in-flow pad emits no keyboard events, so `KeyboardAwareScrollView` never scrolls for it (raising `bottomOffset` changed nothing).
- `widgets/common/keyboard/NumPad/index.tsx`: new `NumPadTargetContext` + exported `useNumPadTarget()` (the field that owns the pad, `null` when down), provided in both the in-flow and pan branches next to `NumPadActiveContext`. The target's identity changes per field, so an effect keyed on it re-runs on every focus move.
- `hooks/useNumPadScrollIntoView.ts` consumes it: after 260 ms it measures the focused input against the scroll view's window bottom and `scrollTo`s the shortfall + 64pt (24pt left the bordered field box touching the pad's top edge: the measured rect is the TextInput, and the box extends ~40pt below it - ⚠️ don't shrink the margin back). Offset is derived from a `collapsable={false}` content wrapper's window y, not `onScroll`.
- ⚠️ Any form with numeric fields in a scroll view needs this hook; tuning `bottomOffset` does nothing for the pad. Wired so far into `DynamicTabRenderer` only; see the follow-up in `deal-center.md`. Not verified on device.

### Comment cleanup (all of `src/` + root app files)

Ticket: *long JSDoc / multi-line `//` blocks above every class, hook and block.* Removed ~15.8k comments across 556 files with a TypeScript-AST pass (not regex), so strings, template literals, JSX text and regexes were never touched.

- Kept: lint / TS directives (`eslint-disable*`, `@ts-*`, `/// <reference>`), and a few single-line (<= 90 chars) comments that flag a trap (`⚠`, `do not`, `TODO`, `workaround`). Multi-line blocks are always dropped.
- Verified: the comment-free emit (`transpileModule`, `removeComments`) of every file is byte-identical to HEAD; `tsc` reports the same 45 pre-existing errors (line numbers only shifted); jest is unchanged (the same 5 suites fail before and after); CRLF/LF endings are unchanged per file.
- ⚠️ The "why" that used to live in code comments is now in `git log -p` / `git blame` (commit before this cleanup) and in the part files here. Re-explain a non-obvious rule in a part file, not as a comment block above the code.
- Native code (`ios/`, `android/`) and `__tests__/` were not touched.

### Environment config now comes from `.env` (`config/env.ts`)

Ticket: *env values were hardcoded in `env.ts` (and derived from the API URL).* `env.ts` now only reads `@env` (babel plugin `react-native-dotenv`, wired in `babel.config.js`, typed in `src/types/env.d.ts`) and exports the same `ENV` shape, so no call site changed.

- Keys: `API_URL`, `GOOGLE_MAPS_API_KEY`, `APIFY_API_TOKEN`, `WEATHER_API_KEY`, `MAPBOX_ACCESS_TOKEN`, `LMS_REDIRECT_URL`, `S3_BUCKET`, optional `S3_BASE_URL` (defaults to `https://<bucket>.s3.amazonaws.com/`). Template: `.env.example`; the real `.env` is gitignored (`*.env`).
- ⚠️ Values are inlined at **build time** and Metro caches transforms: after editing `.env` restart with `yarn start --reset-cache`, or the old value keeps shipping.
- ⚠️ The prod/staging switch (bucket, Mapbox token, LMS host) is no longer derived from `API_URL` - set each one in `.env` (prod values are listed in `.env.example`).
- ⚠️ `env.ts` throws on a missing value outside jest, so a clone without `.env` fails at launch rather than calling an empty URL. `yarn.lock` is gitignored, so run `yarn install` to get `react-native-dotenv`.

### Number pad: decimal layout is 4 columns x 4 rows

Ticket: *"the keyboard with the decimal part should have at least four columns — it takes three; consize it."* The decimal pad was the 3-column grid plus a fifth row (`. 0 back` and a full-width Done). It is now `1 2 3 back / 4 5 6 . / 7 8 9 + a TALL Done (spans the last two rows) / a wide 0` - the same 4 rows as the digits pad, so both modes share one height. `numPadMetrics` (`utils/numpad.ts`) always uses 4 rows (`mode` is now unused; kept for the signature); the key layout is in `NumPadPanel` (`widgets/common/keyboard/NumPad/index.tsx`). ⚠️ The panel height is COMPUTED, not measured: the Done key is `2 * keyHeight + GAP` tall and the left block is 2 rows, so they line up only while `rows = 4`; change both together. The digits pad is unchanged (3 columns, `back 0 Done` bottom row). Not verified on device.

### Follow-up: the tall Done key was a circle and off its column

In the 4-column decimal pad the tall Done key rendered as a near-circle (the `Key` radius is `height / 2`, and a tall key is ~2 keys high) and was wider than the `.` / back column above it (a `flex 3 : 1` split ignores the gaps). `Key` gained a `radius` prop (Done passes `keyHeight / 2`, matching the other pills) and the panel measures one column (`onLayout`: `(width - 5 * GAP) / 4`) so the 3-key block is `3w + 2G` wide and Done is exactly `w`. ⚠️ Keep the explicit widths; the `flex` values are only the first-frame fallback before the measure lands.

### Number pad: `NumPadScrollView` (modal bodies)

`widgets/common/NumPadScrollView.tsx` is a `ScrollView` + `collapsable={false}` content wrapper + `useNumPadScrollIntoView`, for forms whose numeric fields would otherwise sit under the in-app pad. First user: `ResultJobModal` (Down Payment amount box was half cut off); the same hook is also used directly in `DynamicTabRenderer` and `RoofWaiverModal` (see above).
- ⚠️ **A component, not a hook call in the screen**: `useNumPadTarget` reads the NEAREST `NumPadProvider`, and every `Modal` mounts its own (`index.js`). A hook called in the modal's parent component reads the app-root provider and never fires; the component below `<Modal>` reads the right one. The same applies to `useNumPadActive` (see `PadAwareCenter` in `ResultJobModal`).
- `contentTop` = the content container's top padding, so the offset maths stays right. Not verified on device.

### Number pad: ~1 s lag between a key tap and the digit appearing

Ticket: *"the custom num pad lags while pressing a key - the digit takes almost 1 second to show in the field."*

Two causes, both in the tap-to-pixel path:
- **Digits fired on `onPress` (finger UP)**, while backspace already fired on `onPressIn`. Digit and `.` keys now use `onPressIn` (`NumPadPanel`). Done stays `onPress` on purpose (it submits + blurs).
- **Controlled fields waited for the full JS round trip** (`onChangeText` -> parent `setState` -> screen re-render -> `value` prop -> native). On a heavy screen (calculator, job builder) that is the lag. `useNumPadField.setValue` now ALWAYS writes `setNativeProps({ text })` first, so the digit shows at once, then calls `onChangeText`.
- ⚠️ **Reconcile guard**: if a parent filters/rejects the value and does not re-render, the native text would stay ahead of state. A 300 ms settle timer compares the last RENDERED `value` (`rendered` ref, set in render, never mutated by us) with what was typed and snaps the native text back. Do not replace `rendered` with `latest.current` - that one is mutated by `setValue`, so the check could never fire.
- Not verified on device from this session (no jest for RN components): check a controlled money field and a phone field (reformats as you type) on Android.

### `widgets/common/BufferedTextInput.tsx`: debounced parent writes for heavy screens

Follow-up to the number-pad lag ticket (calculator write-up in `deal-center.md` › "Calculator Summary: number-pad typing lag"). A drop-in `TextInput` that keeps the typed text in LOCAL state and tells the parent `debounceMs` (180) after the last key; it flushes immediately on blur / submit / end-editing and on unmount.
- ⚠️ `onBlur`, `onSubmitEditing` and `onEndEditing` receive the flushed text as a **second argument**. The parent's state is still stale in that same tick, so those handlers must use it, not their own state.
- ⚠️ Parent `value` changes are adopted only while no edit is pending (`dirty`), otherwise the parent's old value would overwrite what the rep is typing. A parent that normalises the value (e.g. `0` -> `''`) does not re-sync a locally typed `0` until the value actually changes.
- Use it only where the parent re-render is expensive; small memoised fields should stay plain. It works with the number pad because the pad reads the `value` / `onChangeText` of this inner `TextInput`. Not verified on device.

### Follow-up: controlled fields no longer get `setNativeProps({ text })` (digits flashed bold)

Ticket: *"when I press a digit it shows BOLD, then turns normal a moment later."* The `setNativeProps({ text })` write added for the lag fix (above) paints the digit on Android WITHOUT the field's font style - it rendered heavy until React's own re-render applied the real style. Removing `font-black` from the field did not stop it, which proves the cause is that write, not the class.
- `useNumPadField.setValue` is back to: **uncontrolled fields** (no `value`) use `setNativeProps` (they have no re-render to wait for); **controlled fields** only call `onChangeText` and let the re-render paint. The 300 ms settle timer and `rendered` ref were removed with it.
- ⚠️ **Do not re-add a native text write for controlled fields.** The lag on heavy screens is handled by making the parent re-render cheap instead: `BufferedTextInput` (local state, debounced parent write) - use it on any numeric field whose screen is expensive to re-render. The first fix in this section (digits on `onPressIn`) stays.

### Typed digits bold on Samsung: `fontWeightAdjustment` zeroed in `MainActivity`

Ticket: *"input digits show bold in the calculator (even after reset-cache); only titles should be bold."* Not a JS style problem - the field styles were already Regular. Samsung **Bold font** / Android 12+ **Bold text** sets `Configuration.fontWeightAdjustment`, which the framework adds to an `EditText`'s typeface (`ReactEditText` is one) but NOT to React's `Text` (drawn through a `Layout`), so only typed values looked heavy, and only on devices with that setting on (one tester's screenshot of the same screen was regular).
- `android/app/src/main/java/com/revdsm/MainActivity.kt` overrides `attachBaseContext` (API 31+) to hand the activity a configuration context with `fontWeightAdjustment = 0`. ⚠️ **Native change: needs `yarn android` (rebuild), a JS reload does nothing.** It also makes the whole app ignore the system Bold-text switch, consistent with the Public Sans ticket above.
- ⚠️ The file is CRLF. Not verified on device from this session. The `REGULAR_INPUT_FONT` style in `dealcenter/SharedElements.tsx` stays (harmless, explicit).

## RevRender lighting — "Near you" row (REVUIUX-483 §10)

Backend handoff: `docs/revuiux-483-near-you-backend-handoff.md`. The Teams tab shows up to 6 nearby teams above
the league selector (hidden while searching). Everything is computed **on device**; no new endpoint, and the
address/coordinates go nowhere new.

- **Files:** `utils/revrender-lighting/near-you.ts` (pure: `nearYou`, `resolveOrigin`, `leadCoords`,
  `stateFromAddress`, `haversineMiles`, `NEAR_YOU_CONFIG`), origin wiring in `screens/RevRender/index.tsx`
  (`nearYouOrigin`), row in `lighting/LightingPanel.tsx`. Test: `__tests__/utils/near-you.test.ts`.
- **Data:** catalogue team rows now carry `lat`, `lng`, `state`, `tier` (`Look` widened). ⚠️ Test for
  presence with `isLocatable` (has a `lat`), never `group === 'team'`; branch pro/college on `tier`, **never**
  hard-code a league list (the backend carries it as data so a new league needs no release).
- **Origin order:** lead coordinates (`location.coordinates` is GeoJSON `[lng, lat]`) → address geocode only
  when the lead has none (`geocodeAddress`, once per address) → `lastKnownCoords()` (cached fix; ⚠️ never
  call `getCaptureCoords` / request permission for this) → `getOfficeCoords(user)` → none = row hidden.
- **State** comes from the address text (`stateFromAddress`); with none, the college rule uses its 150 mi
  radius only. Device/office origins borrow the lead's address state when it has one.
- **Interpretations of §10 (not spelled out there):** a 2nd team in a league counts as a "multi-team market"
  only within `metroRadiusMi` (30) of the 1st; favourites are **not** deduped (the spec's wording is
  ambiguous and the row must never be empty); the row is relabelled "Nearest to you" when nothing met a radius.
- ⚠️ **Open product decisions, not coded:** Canadian teams (12) carry a province in `state` and never match a
  US job's state — they only appear via radius/backfill. Tunables are code defaults in `NEAR_YOU_CONFIG`
  (the backend does not serve them yet). The bundled seed `constants/revrender-looks.json` has no locations,
  so the row appears only after the first catalogue refresh from an environment that has been re-seeded.
- **Teams tab default (follow-up):** with a Near you result the tab shows ONLY those tiles plus a "Browse all
  teams (268)" button; the league grid appears after picking a league (with a "Show only teams near you" link)
  and search always searches all teams. With no result (no location, or a backend not yet re-seeded) it falls
  back to the league grid. ⚠️ A dev-only `[NearYou]` log prints origin, located-team count and the result —
  `locatedTeams: 0` means the API is not serving `lat` yet, not an app bug.
- **Browse-teams sheet / nav bar (follow-up):** `CategorySheet` is a `Modal`, so its safe-area insets read 0/stale and
  the Android 3-button bar sat over the pinned **Close** button. Bottom padding is now
  `max(useBottomInset(), 48 on Android) + 16`. ⚠️ Don't swap it back to a fixed `pb-8`.

## RevRender lighting — activity logs (Roofline Lighting mode)

Ticket: *"Roofline Lighting section logs are not added"* — only `select look` was logged; everything else in the
mode was silent. Now every interaction logs through the **same envelope as the core logs**
(`user_id`, `module_type: 'rev_render'`, `created_by`, `meta.{leadId, jobId, screen, viewId}`).

- **One screen helper, `logLighting(action, meta)`** in `screens/RevRender/index.tsx`, passed to `LightingPanel` /
  `LightingFooter` as `onLog` (type `LightingLog`). The panel stays free of user/lead context; add new lighting
  logs through `onLog`, don't import `logEvent` into the panel. Lighting logs carry `renderMode: 'lighting'`.
- **Events:** `change` `render_mode` (Core ⇄ Lighting, old/new) · `change` `browse_looks_tab` (Seasons / Teams /
  Themes / Custom, logged on every tap incl. the active one) · `change` `look_category` (category sheet pick) ·
  `change` `team_search` (**debounced 800 ms**, never per keystroke) · `click` Browse all / Show only teams near you /
  New custom look · `add` `custom_look` (saved) · `select` look (existing, `selected` true/false; the selected-list ✕
  logs `selected:false`, `source:'selected_list_remove'`) · `change` `look_favourite` (hold-popover and star) ·
  `add` "Add to renders" (lookIds/Names, `coreIncluded`) · `start` Generate (now also `coreRenders`,
  `lightingRenders`, `lookNames`) · `delete` queue item (now `renderMode` + look id/name) · photo-guidance buttons.
- Core "+ Add Render Combo" `add` gained `renderMode: 'core'`.
- ⚠️ `index.tsx` is CRLF — edit with `newline=''`.

## RevRender custom look sheet — footer under the system bar, Save with a pending colour

- **Footer:** the pinned Cancel / Save row used a fixed `pb-8`, so Android's 3-button bar was drawn over it. It now
  uses `Math.max(insets.bottom, android ? 48 : 20) + 12` (the Modal-insets floor rule, CLAUDE.md §6).
- **Save enabled by a pending colour:** a colour still open in the picker (not too dark; not an "add" at the 6-colour
  limit) counts as chosen — `withPending` in `CustomLookSheet.tsx`. Save enables and saves it without pressing
  "Add color" first, and the dusk preview shows it live. ⚠️ Save must keep reading `usable` (derived from
  `withPending`), not `colors`, or the pending colour is dropped on save.

## iOS 27 kills the app at launch: the UIScene lifecycle is now mandatory

Two TestFlight crashes came back from the client on build 1.1.0 (28). They were unrelated; this
note covers the launch one. The other (a `SIGABRT` on a background queue from an uncaught
`NSException` in an async void TurboModule method) is not diagnosable from the TestFlight log —
see the ⚠️ at the bottom.

**Symptom.** On an iPhone 17 Pro Max running iOS 27.0 the app died 87 ms after launch, every
time, before a line of JS ran. On iOS 26 devices it was fine, which made it look device-specific.
It is not — it is purely an OS-version trap:

```
Exception Type: EXC_BREAKPOINT (SIGTRAP)   esr: 0xf2000000 (Breakpoint) brk 0
0  UIKitCore  ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke
3  UIKitCore  -[UIApplication workspace:didCreateScene:withTransitionContext:completion:]
```

**Root cause.** The app was built with the iOS 27 SDK (`AppStoreTools: 27A261`) and had not
adopted the UIScene lifecycle: no `UIApplicationSceneManifest`, no `SceneDelegate`, and
`AppDelegate` created its own `UIWindow(frame:)`. Apple escalated that from a warning to a fatal
trap. Confirmed by diffing the symbol across two OS versions — on the iOS 26.4 runtime
(`nm` over its `UIKitCore`) the same check is called:

| OS | symbol | behaviour |
|---|---|---|
| iOS 26.x | `__UIApplication`**`LogRuntimeIssueIfNeeded`**`ForNoSceneLifecycleAdoption` | logs a warning |
| iOS 27.0 | `__UIApplication`**`EvaluateRuntimeIssue`**`ForNoSceneLifecycleAdoption` | `brk #0`, process dies |

⚠️ **This is not a "some testers" bug.** Every user crashes on launch the moment they update to
iOS 27. Treat any future "app won't open at all" report on a new iOS major as this class of thing
first.

**The fix.** `ios/revDSM_Sales/SceneDelegate.swift` (new) owns the window and calls
`startReactNative(withModuleName:in:launchOptions:)`; `AppDelegate` keeps only the Firebase /
Google Maps / factory setup and stashes `launchOptions` for the scene; `Info.plist` gained a
`UIApplicationSceneManifest` naming `$(PRODUCT_MODULE_NAME).SceneDelegate`.

⚠️ **React Native 0.84 ships NO UIScene support** — there is not a single `UISceneDelegate`,
`willConnectToSession` or `UIApplicationSceneManifest` anywhere in the `react-native` package.
None of this came from the RN template and an RN upgrade will not bring it; it is ours to keep
working. What RN *does* get right is `RCTKeyWindow()` (`React/Base/RCTUtils.mm`), which already
walks `connectedScenes`, so RN internals needed no changes. `react-native-keyboard-controller` is
scene-aware too.

⚠️ **`AppDelegate` must KEEP a `window` property, even though the scene owns the window.** Removing
it as redundant swaps the launch crash for a different launch crash — found by actually running the
fixed build on an iOS 27 simulator:

```
-[RNFBMessagingNSNotificationCenter application_onDidFinishLaunchingNotification:]
-[UIResponder doesNotRecognizeSelector:]   →  SIGABRT
```

`window` is an **@optional** member of `UIApplicationDelegate`, and
react-native-firebase/messaging reads `[UIApplication sharedApplication].delegate.window`
unguarded (`RNFBMessaging+NSNotificationCenter.m:90`). No property, no selector, dead app. It only
has to **exist** — `SceneDelegate` assigns the scene's window to it, and it is still nil when that
RNFB observer runs, because the notification fires before any scene connects. Nil is safe: RNFB
uses the value only behind nil checks, and only to flip an `isHeadless` prop on an `RCTRootView`,
which this app never has — the new architecture mounts an `RCTSurfaceHostingProxyRootView`
(`RCTRootViewFactory.mm:190`), so that branch was already dead before the migration.

**Reproduced and verified on an iOS 27.0 simulator** (`xcrun simctl`, runtime 24A434 vs the
client's 24A435). Building HEAD's pre-fix `AppDelegate` gave back the client's crash frame for
frame — `EXC_BREAKPOINT`, `Trace/BPT trap: 5`, the same six frames from
`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` down to `FBSScene`. With the fix
the app launches and runs its JS init. Keep this route in mind: there IS an iOS 27 runtime
installed, so "only crashes on the new iOS" is reproducible locally rather than guesswork.

⚠️ **The manifest and the delegate method fail differently — you need both.** Stripping only
`UIApplicationSceneManifest` from a built `.app` does NOT bring the crash back, because
implementing `application(_:configurationForConnecting:options:)` is itself enough to satisfy
UIKit's adoption check. What you get instead is a **black screen**: the named configuration is not
in Info.plist, so the scene is created with no delegate and no window is ever made. So a blank app
after touching any of this means the manifest, and a launch crash means the delegate method.

⚠️ Do not let `AppDelegate` *create* a window, though. The window must come from the scene
(`UIWindow(windowScene:)`); a `UIWindow(frame:)` belongs to no scene and renders nothing. And
`UISceneConfiguration(name: "Default Configuration")` in `AppDelegate` has to match
`UISceneConfigurationName` in `Info.plist`, or the scene gets no delegate and the app is a blank
white screen.

Nothing needed migrating to the scene callbacks: the app registers no URL schemes
(`CFBundleURLTypes` is absent), never calls `Linking.getInitialURL`, and push arrives through
Firebase/notifee on the app-level `UNUserNotificationCenter` delegate, which scenes do not change.
If deep links are ever added they belong in `scene(_:openURLContexts:)`, **not**
`application(_:open:options:)`.

⚠️ `react-native-screens` still calls the deprecated `[UIApplication sharedApplication].keyWindow`
(`RNSScreenWindowTraits.mm:157`). It resolves fine for a single-scene app, but it is the first
place to look if status-bar or home-indicator traits misbehave after this change.

⚠️ **The second crash needs Crashlytics before it can be named.** It aborts in
`performVoidMethodInvocation` (`RCTTurboModule.mm:467`): a native module's *void* method threw an
`NSException` on a background queue, RN converted it to a `jsi::JSError` and rethrew, and because
`invokeAsync` runs it outside any JS call nothing catches it — `std::terminate`. **Any** uncaught
exception in an async void native method is an instant kill that never reaches the JS error
handler. TestFlight's `.crash` strips both the thread names and the `Application Specific
Information` section that would carry the exception message, so the module is not identifiable
from it. Xcode Organizer's copy keeps that section; failing that, `@react-native-firebase/crashlytics`
(Firebase is already wired) captures the name and reason.

## revRender re-loaded every thumbnail each time the rep came back to the screen

Symptom: open a lead's revRender picker, go back, open it again — every card in the grid shows a
spinner again, worst on the Inspection tab. The photos were already on disk; the screen just
couldn't say so in time.

Two causes, both in `screens/RevRender/index.tsx`:

1. `HouseImage` started with `loading = true` and could only name its file **asynchronously**.
   `warmToLocalCache` is `async` even for a straight cache hit — it awaits
   `ReactNativeBlobUtil.fs.exists`. A native-stack pop unmounts the screen, so coming back
   remounts every card, and every card paid that round trip before it could render anything. With
   4–22 cards that is a visible pass of spinners over a fully cached grid.
2. A mount-time `Image.prefetch` sweep over every photo. ⚠️ `Image.prefetch` **cannot** cache these
   urls — they are pre-signed S3 links with no cache headers, which is the entire reason
   `utils/imageFileCache.ts` exists (the note above). So it re-downloaded every photo on every
   mount, hit nothing, and competed with the thumbnails actually on screen for bandwidth.

Fix — `utils/imageFileCache.ts` now remembers what it has warmed:

- `warmedPaths`, a module map filled only by `warmToLocalCache`, plus `getWarmedLocalUri(url)`
  which answers **synchronously** or null.
- `HouseImage` seeds `resolvedUri` from it and starts `loading` at `!seeded`, so a warm photo
  paints on the first frame with no spinner at all. Its effect returns early on a hit rather than
  re-arming `loading` — ⚠️ re-arming it there puts the whole flicker straight back.
- The prefetch sweep now calls `warmToLocalCache`, which writes a real file, so it actually makes
  the second visit free. ⚠️ Do not put `Image.prefetch` back.
- `PhotoPeekPressable`'s `usePeekCachedUri` seeds from the same map, so a remount no longer drops
  every peek back to cold.

⚠️ The memo is keyed by the **cache path, not the url**. Photo links are re-signed on every read of
the lead, so the same photo arrives under a different url each visit; `getLocalCachePath` dropping
the query is what makes the second visit a hit. Keying on the url would miss every time and look
exactly like no cache at all.

⚠️ Anything that unlinks a cached file must call `forgetWarmedPath` — `enforceImageCacheBudget` and
`clearImageCache` now do, before the unlink and whether or not it lands. A memo entry outliving its
file hands callers a `file://` that resolves to nothing, which is worse than a miss. The same need
is why "tap to retry" uses the new `forgetWarmedUri(url)`: it deletes the **file** as well as the
entry, because a retry that kept an unreadable file would fail identically forever.

The one case the memo can be wrong about is iOS reclaiming `CacheDir` under disk pressure behind
the app's back. Then `getWarmedLocalUri` hands back a `file://` that resolves to nothing, the
`<Image>` fires `onError`, and the rep gets the retry affordance — which clears the entry. That is
the intended recovery; it is not worth an `fs.exists` on every render to pre-empt, since that check
is exactly the cost this change removes.

Not verified on a device — checked by reading, `tsc` (45 errors, the unchanged baseline), `eslint`
(warning count byte-identical to HEAD for all three files) and `jest` (542 pass). The thing to look
at on device is the second visit to a lead's revRender: the grid should come up already painted.

## Android was rendering the SYSTEM font, not Public Sans — the faces were never linked

Client, comparing screenshots side by side: Android type is smaller, thinner, and the heading /
body weight difference that iOS shows is absent.

Not a sizing bug. **`android/app/src/main/assets/fonts/` did not exist**, so not one Public Sans
face was on the device. Every `fontFamily: 'PublicSans-Bold'` resolved to nothing and Android fell
back to the system font — which is also why Android followed the device "font style" setting while
iOS did not. iOS was fine throughout: all 11 faces are in `UIAppFonts` and the Xcode Resources phase.

⚠️ **`link-assets-manifest.json` lied.** It listed 9 of the faces as linked, so `react-native-asset`
was a no-op. The manifest records what a previous run *claimed*, not what is on disk — it had gone
stale (most likely an `android/` regeneration that was not accompanied by a re-link). Emptying the
manifest and re-running copied all 11.

**If Android type ever looks like the device font again, check that directory FIRST**, before
touching `default-font.ts` or any sizing. `ls android/app/src/main/assets/fonts/` is the whole
diagnosis; the JS side has been correct all along.

⚠️ The re-link also rewrites `ios/…/project.pbxproj`, reassigning UUIDs to the two italic faces for
no benefit (same paths, same build phase). That churn was reverted — iOS needed nothing.

⚠️ A `git checkout` of `project.pbxproj` to undo that churn **discards any uncommitted Xcode changes
in it**, which is how the `SceneDelegate.swift` entries from the iOS 27 work were lost and had to be
rebuilt by hand (build file `761780EE…`, file reference `761780EF…`, mirroring the four
`AppDelegate.swift` lines). Copy the file aside before reverting it, not after.

### OS text-size scaling is now capped

Nothing in the app constrained `allowFontScaling`, so the OS text-size setting scaled everything
without limit — the cause of a previously-fixed Job Builder tab-strip clipping, patched there with a
local `maxFontSizeMultiplier={1.3}`.

`index.js` now applies `MAX_FONT_SCALE = 1.25` to the same `ScaledText` / `ScaledTextInput` wrappers
that force the family, so it reaches third-party text too.

⚠️ Deliberately a CAP, not `allowFontScaling={false}`. A rep who raised their phone's text size needs
it, and this app is used outdoors on a doorstep; refusing the setting outright is an accessibility
regression. A call site that passes its own `maxFontSizeMultiplier` keeps it — the two existing
`1.3` sites are unaffected.

### Still open: the optical size difference

⚠️ Linking the fonts is expected to close most of the gap, but **it has not been checked side by
side**. Do NOT reach for `androidTextStyle` / `ANDROID_TEXT_SCALE` before re-comparing on a real
build: that helper exists for a genuine optical difference at the same `fontSize`, and applying it
app-wide was already tried and REJECTED on the Leads screen ("these tabs in android look a bit big").
With the real faces finally loading, the remaining difference may be nil.

## revRender photo-guidance popups: real example photos, and a BLACK primary button

Ticket REVUIUX-483 (comment, Lance): first-time popups when the rep switches mode — Core Products
shows *"Get in close for best results"*, Roofline Lighting *"Zoom out for best results"*, each with
**Got it** and **Got it, don't show me this again**.

The first build shipped copy only, with a green icon circle standing in for the examples. QA against
the design (side-by-side screenshot, 1 Oct) showed two differences, both deliberate in the design:

**The examples ARE the message.** `src/assets/images/revrender-guidance/` now holds three bundled
PNGs, `require`d statically like `green-rooflines-pitchbook`:

| File | Used by | Shown as |
|---|---|---|
| `core-corner-downspout.png` | Core | left tile, caption "Corner + downspout" |
| `core-gutter-fascia-soffit.png` | Core | right tile, caption "Gutter, fascia, soffit" |
| `lighting-full-home.png` | Lighting | one wide tile, viewfinder corners + badge "Full home in frame" |

The Lighting example is framed by **four green viewfinder corners** — brackets say "frame it like
this" in the language of a camera, which is the action being asked for, while the badge names the
rule in words. Each corner is one `View` showing only its two adjacent edges, with the other two
widths spelled out as `0` so a corner never depends on sibling render order.

⚠️ **The corners carry a drop shadow for LEGIBILITY, not depth.** `#2EDE56` measures ~1.7:1
against both the illustration's sky and its road, and all four corners land on one or the other —
sampled from the bundled PNG, not guessed. Unshadowed they wash out exactly where they carry the
message. Do not remove the shadow as decoration; if the illustration is ever replaced, re-check the
four corner regions before doing so.

⚠️ **The overlay is `pointerEvents="none"`.** Corners and badge are drawn on top of the image;
without it they would silently eat taps, which matters on a card whose whole job is to be dismissed.

⚠️ **The badge is a dark pill with white text** (`rgba(22,28,36,0.88)`, 14.6:1 composited over
sky), not the light chip it started as — it sits over sky, which is too light for dark text.

⚠️ **`BADGE_INSET` is derived from the bracket, not typed as its own number.** Badge and
top-left corner both started at inset 10 and overlapped, hiding that corner behind the pill — the
four brackets have to read as four matching marks, and three plus a fragment reads as a rendering
bug. `CORNER_INSET + CORNER_SIZE + 6` keeps the badge clear automatically if the corners move.

A rep skims a tip and taps through it — "get in close" means nothing until you have seen how close.
The two Core shots are ordinary field photos, not studio ones, so they read as "a photo like yours".
Images sit ABOVE the title, which is the design's order: picture first, then the sentence naming it.

⚠️ **The primary button is green `#2EDE56` with BLACK `#161C24` text** — the black label is the
part that looks wrong and has already been "corrected" once. Every other green CTA in revRender
(`+ Add Render Combo`, the mode switch) uses white, but at this green's lightness white sits at
roughly 1.9:1 contrast while black clears 9:1. Do not re-sync it to the other buttons. The green is
the same token as the screen's own CTA, and it needs no dark-mode branch because it reads
identically in both themes — only the card behind it changes.

⚠️ **Radius is `rounded-[14px]`, a soft rect — not the `rounded-full` pill** used elsewhere on
this screen. Inside a 20px-radius card a full pill fights the card's own corners.

⚠️ **The Core tiles use `resizeMode="cover"` on a fixed 150pt box, not `contain`.** They are
portrait field photos; letterboxing them inside the card shrinks the roofline until the detail the
popup is teaching cannot be seen.

⚠️ **`require()` for these is correct** — the IDE hint "may be converted to an import" does not
apply: Metro needs the literal static path to bundle an asset, so a dynamic import breaks the image
at runtime while still typechecking.

### Follow-up — the Core popup never appeared at all

Reported: *"by default guidance modal not appear when i landed in configure Render screen"*.

The trigger hung off `handleModeChange` alone, so it fired only on a **switch**. Configure opens in
Core, which is not a switch — so **the Core tip, the one every rep meets first, never showed**. The
Lighting tip looked fine because Lighting is only reachable BY switching, which is exactly why the
bug read as working software.

It is now a `useEffect` keyed on `[status, mode, guidanceSeen]`, so landing on configure and
switching mode are answered in one place. Keyed on `status` because the tip belongs to the configure
screen — raising it from the photo grid would put it over the wrong screen. `handleModeChange` no
longer raises it; two raisers would fire twice on a switch.

⚠️ **There are now TWO "seen" flags and they are not interchangeable.** `guidanceSeen` (state)
is the persistent *don't show me again*; `guidanceShown` (a **ref**) is this-visit-only. Plain
**Got it** clears `guidanceFor` but deliberately leaves `guidanceSeen` false — the rep did not opt
out — so without the ref the next change to that object (opting out of the OTHER mode) re-runs the
effect and re-raises a tip they already closed. It is a ref precisely so that setting it does not
re-run the effect.

The ref resets on leaving configure, so a NEW photo gets the guidance again: the advice is about the
photo, so it is worth repeating per photo until the rep opts out for good.

⚠️ **Dismissal is still device-local.** Lance specified "per rep account"; there is no endpoint
(see `revrender-lighting-plan.md` §7). A reinstall or a second device re-shows both popups. Not a
bug — an accepted TestFlight gap that must not stay.

## revRender Lighting look tiles rendered as two rows of dots in a near-square box

Reported against the mock: the look grid showed a tall tile with **two stacked rows** of pucks,
where the design is one wide landscape strip with a **single** row.

Two independent causes, both in the defaults:

- **`LookTile` was `width: '23%'` — four per row, not three.** At 23% of the card the tile is about
  78pt wide against a 62pt strip, so it is nearly square and cannot read as a length of roofline.
- **`LightStrip` defaults to `rows = 2`** and `LookTile` never overrode it. The queue-row swatch
  passes `rows={1}` explicitly, which is why the small strip looked right while the grid did not.

Now `TILE_COLUMNS = 3` / `TILE_WIDTH = '31%'` exported from `LookTile`, and the tile passes
`rows={1} pucks={7} height={54}`. On a 390pt phone that is a 101pt × 54pt tile — a 1.87 landscape
ratio — and 7 pucks occupy 93pt, so the row fits without wrapping.

⚠️ **The grid padding in `LightingPanel` imports `TILE_COLUMNS`/`TILE_WIDTH`; it does not retype
them.** `justify-between` spreads a partial row across the full width, so the invisible spacers that
pad a group to a whole row must use the same column count as the tiles. When these were two separate
literals (`% 4` and `'23%'`), changing one silently broke the alignment of every short section —
Everyday has 3 looks, Holidays has 18.

⚠️ **One row of pucks is also the correct DESCRIPTION.** A look is a single run of lights along
a roofline; two stacked rows misrepresent the product being sold, not just the layout.

⚠️ The dashed "New custom look" tile carries its own height — keep it equal to the strip
height in `LookTile` (54) or it sits proud of the real looks beside it.

### Follow-up — tile badges and the Lighting card frame

Three more differences against the mock, all in the same grid:

**The Lighting panel had no card.** Core renders inside `rounded-[24px] border p-5 mb-6` with a
`#2EDE56` outline; Lighting was bare. The two modes swap INSIDE one frame, so a missing frame reads
as a different screen rather than a different mode. `LightingPanel`'s root is a bare `View` with no
padding of its own, so the card's `p-5` does not double up.

**NOW / NEXT moved to bottom-left, on the strip, as a light pill.** They were small green chips
top-right. They label the strip, so they belong on it, and bottom-left is the one corner that never
collides with the select tick or the favourite star. NOW is solid white, NEXT a translucent wash —
the pair is a hierarchy (one is live, one is coming), not two equal labels.

**The select tick moved inside the corner** (`top:5 right:5`, was `top:-6 right:-6`).

⚠️ **All three badges are anchored to the STRIP box, not the outer `TouchableOpacity`** — which
also contains the name label underneath. Anchored to the outer element, `bottom` lands on the text
instead of the strip. This is also why the tick had to come inside: the strip box is
`overflow-hidden`, so a negative offset is now clipped entirely rather than merely overlapping the
neighbouring tile.

### Follow-up — the selected list and Add button belong OUTSIDE the green card

In the mock the green bordered card ends after the look grid; **"N renders selected" and
"+ Add N Render Combos" sit below it on the page background**. They were rendering inside the
border.

Split out as **`LightingFooter`**, exported from `LightingPanel.tsx` and rendered by
`RevRender/index.tsx` as a sibling of the card rather than a child.

⚠️ **Do not fold `LightingFooter` back into `LightingPanel`.** It is the obvious
simplification — same file, same props, used in exactly one place — and it is precisely what puts
the basket back inside the border. The card frames *what the rep can pick*; the basket and its
action are the step after. The separation is the layout.

Consequences of the split, all already applied:

- `LightingPanel` no longer takes `onAdd`, and its `selectedLooks` memo is gone — the panel only
  selects. Both became unused and were caught by eslint, not by tsc.
- The selected rows were restyled to the mock: a tinted group box with white rows inside, a green
  heading, and 20pt star / close icons (up from 18).
- Tile strips went 54 → **64pt** so the grid matches the mock's proportions — about 99 × 64 on a
  390pt phone, a 1.54 ratio. ⚠️ The dashed "New custom look" tile in `LightingPanel` carries its
  own height and must be changed with it, or it sits proud of the real looks.

### Follow-up — the empty state

With nothing selected the footer showed only a greyed button reading
**"+ Add 0 Render Combos"**. The mock has a **"Nothing selected yet / Pick one or more looks
above."** box, and the button reads "+ Add Render Combo".

**`addButtonLabel` now returns the singular for `n <= 1`, not just `n === 1`.** The old
`n === 1 ? singular : plural` sent 0 down the plural branch — correct English, wrong here: the
button is disabled at zero, so the label names the action rather than counting it, and a literal 0
in a greyed-out control reads as a bug rather than as "nothing picked yet". Covered by
`__tests__/utils/revrender-lighting-selection.test.ts`, including that the label carries no count
exactly when `canAdd` is false — the singular at zero is only honest while the control is inert.

**The empty state is a BOX in the slot the selected list occupies**, not an absence. A disabled
button floating under the grid with nothing explaining it reads as broken; the box gives the
greying a stated reason.

### Follow-up — "Browse all" sheet rebuilt to the handoff

`CategorySheet` was a filtered list of filled pill cards. The mock is a titled sheet of grouped
divider rows with a pinned Close.

- **Header** — "Browse teams" + "Pick a league or conference" (themes get the category wording).
- **Grouped under headings.** `TEAM_GROUPS` adds Pro / College · Power 4 / College · More alongside
  the existing `THEME_GROUPS`. ⚠️ Rows are ordered **by the group**, not by the catalogue —
  `categoriesForTab` returns whatever order it holds, so NFL/MLB/NHL only reads as the handoff has
  it because the group lists them. Anything unlisted falls through to "More", so a new league needs
  no edit here.
- **Rows are a list, not cards**: hairline divider, no fill, count right-aligned. Selection is
  named by colour + tick, which does not change row height and so cannot shift the list under a
  tapping finger.
- **"16 schools" vs "32 teams"** — `SCHOOL_GROUPS` carries that distinction; the handoff is
  explicit about it.
- **Close is pinned outside the `ScrollView`** (the list is `shrink`), so it is reachable without
  scrolling past twelve leagues. Sheet raised 70% → **85%**: with chrome plus a pinned footer, 70%
  left only a few rows visible.

⚠️ **The filter field was removed, and its state and the `normalize` import with it.** Teams
has 12 categories and themes 4 — a search box over a list that short is a control the rep must
dismiss to reach what they can already see. The important part: `q` also gated the grouped-vs-flat
branch, so leaving the state behind would have left a branch that could never run. If a filter is
ever wanted back, restore that branch too, or filtered results will be scattered under headings.

## Reanimated 4: the babel plugin is `react-native-worklets/plugin`, and it was missing

`babel.config.js` had presets only. With **reanimated 4.4.1 + react-native-worklets 0.9.1**
installed and no worklet plugin, the app **builds fine and then SIGABRTs at launch** with
`getValueUnpacker: assertion failed` — so it presents as a native crash, not a config problem.
That is the whole difficulty: nothing in the build output points at babel.

⚠️ **It is `react-native-worklets/plugin`, NOT `react-native-reanimated/plugin`.** Reanimated 4
moved worklet transformation out into its own package. The old path is what every pre-4 tutorial
says, and it does not exist here.

⚠️ **It must stay LAST in `plugins`.** It rewrites worklet-marked functions; a plugin after it
runs on transformed output and can undo the rewrite.

Verify a change to this file by transforming a real file rather than trusting the build —
`babel.transformFileSync` on a `'worklet'` function, checking the output contains `__workletHash`.
(A nonexistent filename makes the plugin throw ENOENT, which looks like a plugin failure and is not.)

## revRender light-strip glow: three halos, because `shadowColor` is iOS-only

The look tiles' LED glow used `shadowColor` / `shadowOpacity` / `shadowRadius` plus `elevation: 4`.
On Android that is **a grey drop shadow** — `elevation` cannot express a coloured glow — so the
strips rendered flat and muddy while looking correct on iOS.

Now three absolutely-positioned translucent halos per puck behind the lens (3.2× @ 0.10, 2.2× @ 0.16,
1.5× @ 0.30), which renders identically on both platforms.

⚠️ **The halos must never affect layout.** They are `position: 'absolute'` and
`pointerEvents="none"` inside a fixed-size cell. **The dark gaps between pucks ARE the product** — if
the halos push the pucks apart or merge into a continuous line, the strip stops describing what is
being sold.

⚠️ **The channel band is part of the design, not decoration.** A faint track with a lit top edge
behind the pucks, standing in for the aluminium channel. Without it the lights float in the dark
rather than reading as a fitted product. Also absolutely positioned, and it deliberately bleeds past
the puck row so the channel runs off both edges like a real run.


## revRender custom look builder: six colours, a dusk preview, and a picker that opens

Reported against Lance's mockup: the custom look sheet did not match it, and the colour limit was
wrong. Four separate gaps, all in `lighting/CustomLookSheet.tsx`:

**`MAX_CUSTOM_COLORS` was 4; the mock says "Colors · up to 6".** The catalogue's own ceiling is 6
too, so a rep building a six-colour school look hit a dead "Add" button two colours early. The
section label is now generated from the constant (`Colors · up to {MAX_CUSTOM_COLORS}`) so the
number on screen cannot drift from the number enforced.

⚠️ **At the limit the plus button is DISABLED, not hidden.** A control that vanishes reads as a
glitch; a greyed one that stays put, with "That's all 6 colors. Remove one to swap it out."
underneath, says the limit is deliberate.

**There was no dusk preview.** Swatches say which colours were picked; only the preview says what
the homeowner will see, which is the thing being sold. Added as `DuskPreview` — dusk sky, the
channel, 18 pucks with halos, and a wash of light down the wall below. It is also the one place the
*pattern* becomes visible, since the sheet has no pattern control.

The puck sequence comes from **`puckColors()` in `utils/revrender-lighting/colors.ts`** — pure, so
it is tested (`__tests__/utils/revrender-lighting-colors.test.ts`). ⚠️ One colour renders `single`
whatever pattern is passed: mid-build (first colour added, pattern already computed as
`alternating`) the preview would otherwise show something the product cannot do.

**The wheel was always on screen; it is now a picker card that opens per swatch.** Permanently
mounted, it pushed the preview and Save off the bottom of a small phone. Tapping a swatch opens the
card on that colour ("Update color"), the dashed plus opens it empty ("Add color").

⚠️ **The footer is pinned outside the `ScrollView`** (which is `shrink`). With the picker open the
content is tall enough that Save would otherwise be unreachable.

**Brightness was five fixed chips; the mock has a continuous Darker → Brighter track.** The wheel
covers hue and saturation only, so value needs its own control or dark and muted shades are
unreachable. Implemented as a `PanResponder` over a 24-step ramp of the current hue, with the knob
positioned from `hsv.v`. The wheel knob is likewise driven from `hsv.h`/`hsv.s` — without it the
wheel gives no feedback once you lift your finger.

## revRender Custom tab: the "New custom look" tile goes FIRST

⚠️ It was appended **after** the saved looks. Making a new look is the reason the tab exists, and
appended last the button drifts further away with every look a rep saves. The mock puts it first.

The grid pads around it: the new tile occupies one column, so the padding count is
`(TILE_COLUMNS - ((customs.length + 1) % TILE_COLUMNS)) % TILE_COLUMNS`. Forgetting the `+ 1`
spreads a single saved look across the whole row.

"Hold one to edit" renders only when there is something to hold — a hint about editing looks the rep
has not made yet is noise.

## revRender colour picker: a crash on the brightness bar, and a wheel that scrolled the sheet

Two device reports against the custom look builder, one root cause each.

### The crash: `Math.max(0, NaN)` is NaN

Dragging the brightness bar crashed the app. The chain:

1. A touch that leaves the view can report an **undefined coordinate**. The handlers used
   `nativeEvent.locationX`, which is only meaningful inside the view — and dragging off the end is
   exactly what you do when you grab the knob and keep going.
2. `undefined / width` is `NaN`.
3. ⚠️ **`Math.max(0, NaN)` returns `NaN`** — a min/max clamp does **not** filter NaN out. This is
   the whole bug; the code looked clamped and was not.
4. The NaN reached `hsvToHex`, where a NaN hue makes the sector index NaN, the sector lookup returns
   `undefined`, and destructuring it **throws** (`t is not iterable`) — during *render*, so it takes
   the screen down rather than just producing a wrong colour. It also reached styles directly as
   `backgroundColor: "#NANNANNAN"` and `left: "NaN%"`, and **Android throws on an unparseable colour
   string**.

Fixes, defence in depth:

- **`clamp01()` in `utils/revrender-lighting/colors.ts`** — every gesture-derived number goes
  through it. ⚠️ Only **NaN** falls back; **±Infinity clamps to the end of the range it points at**,
  because it means a real overshoot (a divide by zero width). An earlier version used
  `!Number.isFinite()` and snapped the bar to black on a hard drag right — the test caught it.
- **`hsvToHex` sanitises its own inputs** and wraps hue, so it can no longer throw from any caller.
- **`hexToHsv` returns a usable colour for a malformed hex** instead of NaN channels.
- Gestures now track **page coordinates** against a frame measured with `measureInWindow`, which
  stays valid outside the view, so the NaN is not produced in the first place.

⚠️ The frame is re-measured on **every grant**, not only on layout: the sheet scrolls, and a stale
origin offsets every hue by the scroll distance.

### The wheel scrolled the sheet instead of picking a colour

Dragging the knob vertically scrolled the enclosing `ScrollView`. Two changes, both needed:

- **`onStartShouldSetPanResponderCapture` / `onMoveShouldSetPanResponderCapture`** (the `Capture`
  variants) plus `onPanResponderTerminationRequest: () => false`, so the responder claims the touch
  before the ScrollView is offered it and does not hand it back mid-drag.
- ⚠️ **Capture alone was not enough on Android** — the ScrollView could still take a drag that
  started mostly vertical. The sheet also sets `scrollEnabled={!dragging}` while a knob is held.

⚠️ `dragging` is cleared on **both** `onPanResponderRelease` and `onPanResponderTerminate`. Release
alone leaves the ScrollView permanently frozen when a gesture is interrupted — an incoming call, the
sheet dismissing mid-drag.

## revRender favourites: a confirm popover on hold, and per-rep-account persistence

Two changes that arrived together — the mock's long-press behaviour, and the backend's new
preferences endpoints (`docs/claude/revrender-preferences-api.md`).

### Holding a tile raises a bubble; it does not toggle

⚠️ **A hold no longer favourites directly.** It raises a dark "Favorite" / "Unfavorite" pill above
the tile and the rep taps that to confirm, as the mock has it. A gesture that silently changed state
was both undiscoverable — nothing on screen said it existed — and unforgiving, since an accidental
hold altered the rep's list with no visible way back.

`LookTile`'s `onLongPress` now reports the tile's **window frame** (`measureInWindow`) rather than
firing an action, so the caller can anchor the bubble to the tile that was held.

⚠️ **`FavouritePopover` renders in a `Modal`.** Inline it is clipped by the lighting card's
`overflow-hidden` and it scrolls away from the tile it belongs to. It prefers to sit above the tile
and flips below when that would run under the header, and it is clamped to the screen edges.

`Vibration.vibrate(18)` on the hold confirms the gesture registered before the bubble animates in —
the same pattern as `useChatSession`; there is no haptics package in this repo.

### Favourites and recents now live on the rep's account

`LeadService.getRevRenderPreferences()` on mount, `toggleRevRenderFavourite(lookId)` on each tap.

⚠️ **Toggle, never a whole-list write.** `setRevRenderFavourites` exists for offline reconciliation
only. If two devices each sent their full list, the later one would silently wipe the other's
change.

⚠️ **The toggle is optimistic and MUST revert on failure.** A favourite is one tap and has to feel
instant. But without the revert the star stays filled against a list the server never took, so the
rep believes the look was saved and loses it on reload.

⚠️ **`applyServerPreferences()` deliberately merges only `fav` and `recent`.** The GET also returns
`customLooks` and `guidanceDismissed` and they are **always empty today** — the fields exist,
nothing writes to them. Spreading the response into state would delete the rep's custom looks on
every single mount. It also leaves `sel` alone, which is this screen's working state.

### `recordRendered()` is deleted — do not add it back

"Recently Rendered" is now derived server-side from completed run rows (`renderType: 'look'`,
newest first, distinct ids). A run row only exists once a render **completed**, which settles 483
§13's open question ("record at Add or at Generate?") by construction. Writing recents from the
client as well would be a second source of truth, and the two would disagree the first time a
generate failed after the queue was built. A tombstone comment sits where it was.

⚠️ **Keep filtering favourites out of recents CLIENT-SIDE** in `recentsToShow()`. The server
deliberately does not filter: filtering at display time is what makes unfavouriting a look bring it
straight back into Recents. Doing it server-side would make that irreversible.

### Still device-local

Custom looks and photo-guidance dismissal. The backend stopped short deliberately — custom looks
hold real content rather than ids, so they need decisions nobody has made (what happens when a rep
edits one already used by a render, whether names are unique per rep, whether they sync at all).
⚠️ They currently live in **component state**, so they are still lost when the screen unmounts; the
interim fix the backend doc asks for is device storage, which is **not done yet**.

## revRender queue rows: the LIGHTING / CORE badge is right-aligned

Reported against the mock: the mode badge sat immediately after the photo label instead of at the
right edge beside the delete button.

It was a **child of the title group** (`[number] [label] [badge]`), so the row's `justify-between`
pushed that whole group left and the badge landed wherever the label happened to end — a different
x-position on every row, and visually a suffix on the photo's name.

It is now a **sibling**, grouped with the delete button on the right:

```
[1] Front  ……………………  [• LIGHTING] [🗑]
```

Two sizing rules make it hold:

- ⚠️ The title group takes `shrink min-w-0` and the label `numberOfLines={1}`. Without `min-w-0` a
  flex child will not shrink below its content width, so a long photo label would push the badge
  and the delete button off the right edge instead of ellipsizing.
- ⚠️ The badge group takes `shrink-0` so the badge is never compressed to fit a long label — the
  text is the tag, and a clipped "LIGHTIN" is worse than a truncated photo name.

Nothing about the badge's own styling changed (`#1F2937` / `#FFC94D` with the amber dot for
Lighting, neutral for Core); only where it sits in the row.

## revRender Results: image loaders, and renders appearing without a pull-to-refresh

Two reports against `Your Renders` (`screens/RevRender/lighting/ResultsPanel.tsx`), with one shared
cause: **the screen navigates to Results the moment generation is requested**, while the server
takes ~30 s per render.

### Renders only appeared after pull-to-refresh

`load()` ran once on mount, so the panel fetched the runs list before any of the new renders
existed, reported **"0 ready"**, and then sat there. The rep had to pull-to-refresh to discover
their work had succeeded.

`RevRender/index.tsx` now records `setPendingRenderCount(payloads.length)` when it submits, and
passes it as `expectedNewRenders`. The panel polls every **5 s** until they land.

⚠️ **The target is `baseline + expected`, not "the list is non-empty".** A rep usually already has
renders from an earlier batch, so stopping at the first non-empty response would stop immediately
and show only the old ones.

⚠️ **A failed request returns `-1`, not `0`.** Returning 0 would read as "no renders yet" and, on a
baseline of zero, satisfy nothing while silently looking like progress — the poll must not treat a
network error as a measurement.

⚠️ **`POLL_TIMEOUT_MS` (5 min) is a hard ceiling** so a render that never completes cannot poll
forever in the rep's pocket, and ⚠️ **the timer is cleared on unmount** — the panel is dismounted by
Back, and a live timer would keep hitting the API against a dead screen.

### The image area was blank white while loading

Full-size renders come from S3 over a rep's cellular connection, so each card showed an empty
200 pt panel for several seconds. Each card now tracks its own load state, keyed by `runId`.

⚠️ **The spinner sits BEHIND the `<Image>` in a fixed-height box; the image is never swapped out
for it.** Conditionally rendering the `<Image>` restarts the download each time the flag flips, and
the card jumps when a differently-sized placeholder is replaced.

⚠️ `imageLoading[runId] !== false` — the spinner shows until `onLoadEnd` explicitly sets `false`.
Testing truthiness would hide it on the first frame, before `onLoadStart` has run, which is exactly
the moment it is needed.

### Two empty states, not one

"No renders yet · Generate from the queue" is **wrong** while a generate is in flight: it tells the
rep nothing is coming, seconds after they asked for it. While `awaitingRenders` the panel shows a
spinner and "Generating your renders… about 30 seconds each", and the header reads
`N ready · generating…` rather than a count the rep can see is stale.

## iOS build & launch traps (Xcode target membership, build DB)

### Blank app on launch: `SceneDelegate.swift` was never added to the Xcode target

Ticket: *app launched to a black screen with a working status bar — in the simulator, in a local
Release build, and on TestFlight.* Native came up fine (status bar, scene, window); no JS ever ran.

**Root cause.** `ios/revDSM_Sales/SceneDelegate.swift` existed on disk but was absent from
`project.pbxproj` entirely — no `PBXFileReference`, no `PBXBuildFile`, not in Compile Sources. So the
class was never compiled into the binary, and the console said so on every launch:

```
UIWindowSceneSessionRoleApplication contained UISceneDelegateClassName key,
but could not load class with name "revDSM_Sales.SceneDelegate".
```

`Info.plist` names `$(PRODUCT_MODULE_NAME).SceneDelegate` as the scene delegate; UIKit could not
resolve it, so the scene got **no delegate**, nothing ever called
`factory.startReactNative(withModuleName:in:launchOptions:)`, and the window stayed empty.

- ⚠️ **A Swift file on disk is not in the build.** It must appear in the target's Compile Sources.
  Add it in Xcode (right-click the group › Add Files, **Reference files in place**, tick the target) —
  hand-editing `project.pbxproj` needs four separate entries and is easy to corrupt.
- ⚠️ **`could not load class with name "<Module>.<Class>"` means the class is not in the binary.**
  Check Compile Sources first; `$(PRODUCT_MODULE_NAME)` resolution is the rarer second cause.
- The symptom is identical in Debug and Release, which is what makes it confusing: Metro being up or
  down changes nothing, so the usual "is Metro running / --reset-cache" path is a dead end. **If the
  status bar renders but the app is black in BOTH Debug and TestFlight, read the device console for a
  scene-delegate line before suspecting Metro or the JS.**
- Ruled out on the way, all three innocent: `config/env.ts` throwing on a missing key (the `.env`
  values *are* correctly inlined into a production bundle — verified by extracting `API_URL`'s value
  from a `--dev false` Hermes bundle with `strings`), the `UIApplicationSceneManifest` entry itself
  (present and correct), and the `SceneDelegate` implementation (correct — it binds the window to the
  scene via `UIWindow(windowScene:)` and borrows the factory from `AppDelegate`).

### `bundleURL()` and the `#if DEBUG` implicit-return scare (NOT the blank-screen cause)

While chasing the blank screen above, `ReactNativeDelegate.bundleURL()` in `AppDelegate.swift` looked
like a second bug: neither `#if DEBUG` branch had an explicit `return`. Explicit `return`s were added
and are worth keeping for clarity.

- ⚠️ **This was never the cause.** Swift's implicit return reaches inside `#if`/`#else`, so the
  original compiled and returned correctly. Do not cite it as the fix, and do not "restore parity"
  by removing the `return`s either — they are harmless and clearer.

### Xcode "database is locked" is not a project error

`unable to attach DB: ... build.db: database is locked. Possibly there are two concurrent builds
running in the same filesystem location.` means exactly what it says: Xcode and a second builder
(a terminal `xcodebuild`, or an interrupted earlier build that left a `build.db-journal`) hit the
same DerivedData.

- Fix: make sure no `xcodebuild`/`XCBBuildService` is running, then delete
  `DerivedData/<project>-<hash>/Build/Intermediates.noindex/XCBuildData`. Xcode regenerates it; it
  costs one full rebuild and leaves `Pods.build` and the rest of DerivedData alone. Nuking all of
  DerivedData is not necessary.
- ⚠️ Don't run `xcodebuild` from a terminal while Xcode is building the same workspace — that is how
  the lock gets created in the first place.

## `MainHeader.onNavigate` ends the rep's lead session

`widgets/common/MainHeader.tsx`. Every header route funnels through one `onNavigate`, which calls
`endActiveLeadWorkSession()` **only when the destination is `homeRoute`** (`Leads`, or
`InstallerDashboard` for an installer).

⚠️ **Only home ends the lead.** Account Settings, Job Tracker, My Learning, the notification bell
and chat are side trips a rep takes from INSIDE a lead and returns from — they are part of working
it. An earlier version fired on every header navigation and ended the session on all of them, which
is wrong. Lead Center's own `HeaderContext` handler gates on the same destination.

⚠️ **Do not remove that call as "the header shouldn't know about leads".** It is there because the
header is the only component that sees *every* way a rep leaves a lead. Lead Center used to bind
its own handler through `HeaderContext`, but inside a `useFocusEffect` — which tears down the
moment a child screen (Deal Center, Job Builder, Pitch Book) opens, so leaving from there released
nothing and the rep stayed live on the ops board.

⚠️ **Fire-and-forget, and it must stay that way.** Navigation must never wait on two network
calls, and a rep leaving a door often has no signal. It is also safe to call unconditionally: it
reads the active session from MMKV and no-ops when none is open, so it costs nothing on screens
that have no lead.

Full ticket, including why both paths clear the stored session before awaiting (the double-send
guard): [`lead-center.md`](lead-center.md).

## Ticket — the axios timeout, and noticing a stall from the interceptors

Changed in `services/api/index.ts`. Full ticket, including why `/health` was never being called:
[`offline.md`](offline.md).

**`timeout: 120000` → `REQUEST_TIMEOUT_MS = 15_000`.** Two minutes is what a rep on 1 bar of 5G
actually waited in a client video — and twice over, because the TanStack default is `retry: 1`
(`services/api/queryClient.ts`), so the real ceiling was **four minutes** of dead screen. A
request that has not answered in 15 s on a field device is not going to; the cached copy is the
better answer.

⚠️ **The timeout is the ceiling on every offline fallback in the app.** Nothing downstream — no
banner, no cache, no queue — can engage until the request gives up, because all of it is reached
through the error interceptor. Raising this number again silently lengthens every one of them.

**Both interceptors now bracket the request**: the request interceptor calls `beginRequest(config
.url)` and stashes the id on `config.__inFlightId`; both response handlers call `endRequest(...)`.
That lets `services/connectivity.ts` fire the `/health` probe **while a request is still open**,
which is the only way to detect a connection that stalls instead of failing.

⚠️ **The id must be released on BOTH paths.** A miss on the error branch leaks an entry that never
clears, and the tracker then reports a permanent stall — the app would sit in "Weak connection"
for the rest of the session. Both `endRequest` calls read through `?? null`, so a request that
never reached the request interceptor (an axios config error) is a no-op rather than a throw.

⚠️ **`beginRequest` returns `null` for the probe's own URL**, so the probe is never measured as
traffic by the thing it feeds. The probe uses bare `fetch`, not this instance, so it is only
reachable here if someone routes it through axios later — the guard is cheap insurance.


## `AnnotationRenderHost` - an app-root hidden WebView

`widgets/common/AnnotationRenderHost.tsx`, mounted once in `App.tsx` beside `FlashMessage`. Zero-size and invisible, it is the canvas `services/annotationRenderer.ts` draws on, so an annotated photo can be flattened after the annotation screen has closed (Save no longer blocks). ⚠️ Keep it mounted at the ROOT - a WebView inside the screen dies with the screen and takes in-flight renders with it. Its page is `utils/annotation-render-html.ts`. Details: `lead-center.md` § "Annotation Save".


## Photos already on the device must not show a spinner when a screen is reopened

Report (Manage Photos): *"every time I come on this screen all the images show loading, even ones I already viewed - only a NEW or newly annotated image should show it."* Two causes, both fixed:
- `widgets/common/LoadingImage.tsx` started with `loading = true` for EVERY image and waited for `onLoadEnd`, so a photo that was already a `file://` on the device flashed a spinner on each mount. It now only spins for a REMOTE uri that has not loaded yet this session (`needsSpinner`: not a local file and not in `loadedKeys`, keyed by the url WITHOUT its query so a re-signed url does not look new). ⚠️ Do not put the spinner back for local files - it is meant for bytes that are really still arriving.
- `utils/imageFileCache.ts`: `warmedPaths` is in memory only, so on a cold start every saved photo had no known local file and drew from its remote url (spinner + re-download) until an async `exists` came back. Cache files are now ALSO recorded in MMKV (`imgcache:<path>`, via `rememberWarmed`), and `getWarmedLocalUri` answers from that index synchronously, so the first render already points at the file. The index is only a hint: `verifyIndexedUri` confirms it on disk once per session, and `hooks/useWarmedImageUris.ts` falls back to the url (and re-warms) for any entry the OS purged. ⚠️ Anything that deletes a cache file must go through `forgetWarmedPath` (it also clears the index) or a stale index would point at a missing file. The `imgcache:` keys are session-scoped, so a logout only loses the cold seed, never a photo.
- Not verified on device: kill + relaunch, open Manage Photos - saved photos paint with no spinner; a genuinely new photo still spins until it arrives.

- **Follow-up - `LoadingImage` holds the previous image across a uri change.** When `uri` changes after a first paint (a pending photo handing over to its server copy, a re-edit's new bytes), the old image stays under the new one until the new one has painted, and `onLoaded` fires when it has. ⚠️ Do not replace that with a plain `<Image source={{uri}}>` swap - the tile blanks while the new file decodes. The spinner is suppressed while a previous image is being held.

- **Follow-up - `getLocalCachePath` keeps the query for Google Maps urls** (`utils/imageFileCache.ts`, `isQueryKeyedUrl`). The rule "drop the signature so a re-signed url still hits the cache" is right for S3 but wrong for `maps.googleapis.com` / `maps.google.com`, where location / size / heading live in the query: all leads' street views shared one file. ⚠️ Any other host whose query is the identity needs adding there. See `notifications-chat.md` (street-view header picture).

### RevRender screen - the queue is cleared only after the submit is answered

`screens/RevRender/index.tsx` `handleGenerateAll` now AWAITS `onGenerateAll` / `onGenerate` (button shows "Sending..." via `isSubmitting`, second tap ignored) and only then runs `setRenderQueue([])` + `navigation.goBack()`. Before, the submit was un-awaited and the queue was cleared at once, so a failed POST lost the rep's whole configuration. A render that fails keeps its payload on the Lead Center Tools card (Retry / Dismiss). ⚠️ The queue screen itself is still not persisted - a force-quit while on it loses it. Details: `docs/claude/offline.md`.

### A dropped connection no longer raises the red "Console Error" screen - fixed globally (`utils/console-noise.ts`)

Reported twice in different places ("[Reports] S3 Resolve Error: Network Error" in `useLeadReports`, "Failed to resolve secure URLs ... Network Error" in `JobDocsSection.resolveDocs`). Cause: `console.error` in dev raises React Native's full-screen LogBox, and the app has hundreds of `catch { console.error('Failed to ...', err) }` - so any signal loss looked like a crash. Fixing call sites one by one does not scale, so `index.js` calls `installNetworkErrorDowngrade()` once: a `console.error` whose error-like arguments are ALL transport failures (`isTransportNoise`: `Network Error`, `Network request failed`, `timeout of Nms exceeded`, `ECONNABORTED` / `ERR_NETWORK` / `ETIMEDOUT`, no host) is logged with `console.log('[network]', ...)` instead.
- ⚠️ A payload with an HTTP status (`httpStatus` / `response.status` / `status`) is a SERVER answer and stays a loud `console.error`, as does any transport error sitting next to a real error in the same call. Ordinary errors are untouched. Tests: `tests/offline/console-noise.test.ts`.
- ⚠️ Install it from `index.js` (after React Native has set up LogBox) - it wraps whatever `console.error` is at that moment. New code should still prefer `isNetworkError` (`utils/network-error.ts`) and a quiet recovery over relying on this net.
- Not a fix for the cause: the call that failed still failed (the row simply keeps its last data). Not verified on device.

- **File map for the two app-wide changes this session:** `index.js` installs `installNetworkErrorDowngrade()` (see "A dropped connection no longer raises the red Console Error screen"); `screens/RevRender/index.tsx` awaits the submit before clearing its queue (see "RevRender screen - the queue is cleared only after the submit is answered"). Both are written up above.

## Firebase Crashlytics (crash + non-fatal reporting)

- **Wiring:** `@react-native-firebase/crashlytics` ^26.4.1 (keep `app`/`crashlytics`/`messaging` on the SAME version: ⚠️ `app` 26.4.0 pins Firebase iOS 12.18.0 while 26.4.1 pins 12.19.3, so a stale `node_modules` (`yarn install`) makes `pod install` fail with "could not find compatible versions for Firebase/Crashlytics" against a Podfile.lock from 26.4.1). Same class of failure for `react-native-keyboard-controller`/`pdf`/`safe-area-context`/`screens` (pod install silently DOWNGRADES the lock to the stale installed versions): after pulling, `yarn install` and `npx patch-package` (a `yarn upgrade` can leave patches unapplied; compass-heading's podspec then asks for the non-existent `RCT-Folly`), then `bundle exec pod install` (add `--repo-update` if a Firebase pod version is 'not found' - stale spec repo). `hermes-engine`/`React-Core-prebuilt`/`ReactNativeDependencies` checksums in Podfile.lock differ per debug/release tarball - benign. Android: `firebase-crashlytics-gradle:3.0.2` classpath in `android/build.gradle` + `apply plugin: "com.google.firebase.crashlytics"` after google-services in `android/app/build.gradle` (uploads R8 mappings). iOS: a "Upload Crashlytics dSYMs" run-script phase (last build phase) calling `${PODS_ROOT}/FirebaseCrashlytics/run`. Needs `bundle exec pod install` from `ios/` and a native rebuild; no new Firebase config files.
- **`src/services/crashReporting.ts`** is the only door: `initCrashReporting` (called from `index.js`), `recordError`, `logBreadcrumb`, `setCrashUser`, `setCrashAttribute`. Everything is wrapped in try/catch and lazy-`require`d, so a missing native module (jest, an old binary) is a silent no-op and reporting can never crash the app.
- **Collection is `!__DEV__`**: Metro/dev builds never reach the dashboard; ANY release build reports - production and non-production (demo/staging) alike. Test a report on a RELEASE build only.
- **Environment tagging:** `initCrashReporting` sets custom keys `environment` (`production` | `non-production`), `api_host`, `build`, `platform`. `utils/crash-environment.ts` derives it from `ENV.API_URL` (labels demo/dev/stg/staging/qa/uat/test/sandbox/np/local, an IP or no host => non-production; anything else => production). ⚠️ A production host that contains one of those labels would be mislabelled - adjust `NON_PROD_LABEL`. Filter in Firebase: Crashlytics > Add filter > Custom keys > `environment`. Test: `__tests__/crash-environment.test.ts` (gitignored).
- ⚠️ The library installs its OWN `ErrorUtils.setGlobalHandler` and unhandled-promise-rejection tracking when the module loads. Do not add a second global handler - `initCrashReporting()` in `index.js` is what loads it.
- **Covered:** native crashes (automatic); JS fatal + unhandled rejections (library); render errors (`widgets/common/AppErrorBoundary.tsx`, root of `App`, shows a "Try again" screen); API 5xx (`reportServerError` in `services/api/index.ts` - method + path with ids masked + status only; 4xx/offline/timeouts are deliberately NOT reported, they are normal in the field); screen-change breadcrumbs (`App.tsx` navigation callbacks).
- **User:** `App.tsx` sets the opaque user id + role + company id after login and clears them on logout. ⚠️ No email/name/phone - PII stays out of Crashlytics.
- ⚠️ Never put tokens, document payloads or base64 in `recordError`/`logBreadcrumb`; `recordError`'s `extra` goes through `sanitizeForLog`.
- Not verified on device (could not run pods/build here). Verify: release build, call `crash` once, relaunch, see it in the console.
- **Device test panel REMOVED** (verified end to end: a test crash reached the Firebase console). `CrashlyticsTestPanel`, `sendTestNonFatal`, `forceTestCrash` and `getCrashlyticsStatus` are gone. To re-verify later, call `a.crash(i)` temporarily from a release build and relaunch - do not ship a trigger.

## The strips under the header: connection, then sync

`MainHeader` renders two one-line strips directly under the header bar, in this order: `OfflineBanner` (connection) then `SyncBanner` (queue). Both are app-wide, so every main screen gets them and no screen rolls its own. Full note on the sync one - why it replaced the pending-uploads card, and why it never reports errors - is in **`docs/claude/offline.md`** ("the pending-uploads CARD became a one-line strip").

- WARNING: **neither strip ever shows an error.** The sync strip is silent for `failed` / `needs-review` work on purpose: a rep cannot act on a sync error mid-appointment, and a red notice on the main screens reads as "the app is broken". Anything needing a human belongs in Profile -> pending uploads. Do not add an error state to either strip.
- They stack and must stay visually alike: same height, same 11pt single-line text, same centred icon-plus-text. `OfflineBanner` owns amber (offline / weak); `SyncBanner` owns blue (in flight) and green (done). Don't reuse amber in the sync strip - the colours are how a rep tells the two apart at a glance.
- Logic for both is pure and testable - `utils/connection-banner.ts` and `utils/sync-banner.ts` - because neither component can be loaded under jest. Put any new rule in the util, not the component.

### Upload requests and the stall watcher (`services/api/index.ts`)

A `FormData` request is registered with `beginUpload()/endUpload()` (see `docs/claude/offline.md`, "Cellular hardening") and is deliberately NOT passed to `beginRequest`, so the stall watcher cannot mistake a slow upload for a dead channel. Do not route uploads back through `beginRequest`.


### Follow-up - `removeCachedPath`: the one sanctioned way to delete a single cache file (2026-10-29)
Files: `utils/imageFileCache.ts` (`removeCachedPath`), used by `services/leadPhotoCache.ts`. Full ticket: `offline.md` § "Photo cache holds only leads with offline work".
- New export that unlinks ONE cache file and clears its `imgcache:` index entry (through `forgetWarmedPath`). It refuses any path that is not a `revrender_` cache file and resolves `false` if the file is already gone.
- ⚠️ Per-lead pruning must go through it, never a bare `unlink`: a stale MMKV index entry would point `getWarmedLocalUri` at a missing file and the tile would paint blank instead of falling back to its url.
- The `revrender_` prefix is shared by lead photos, pitch-book, logo and RevRender files, so nothing may delete "all files not in the lead index" - only the paths the lead index recorded.

### Lead Create: invisible keyboard gap under the pad

Ticket: *"after First/Last Name, tapping Phone leaves the old keyboard's space invisible and the pad is misplaced."* The sheet's keyboard-controller `KeyboardAvoidingView` had `enabled={!numPadActive}`. Text -> numeric switch: the system keyboard is up (sheet shrunk by its height), the pad attaches and dismisses it with `keepFocus`, but the avoider was already disabled, missed the hide event and kept the keyboard-sized padding - a gray gap under the pad.
- Fix: `LeadCreate/index.tsx` leaves the avoider always enabled. ⚠️ Do not re-add `enabled={!numPadActive}`; the pad is Android-only now, so the iOS stale-height reason for it is gone. Not verified on device.

### Camera: Photo / Video switch (`CustomCameraModal`)

Ticket: *"my camera only has picture functionality - let them switch between photos and videos"* (iOS-camera look: `Photo   Video` labels, active one yellow, above the zoom pills).
- **Opt-in `allowVideo` prop (default `false`).** With it, the shutter in Video mode starts / stops a `vision-camera` recording (red inner circle -> red stop square, a red `m:ss` badge in the viewfinder; `formatRecordingTime` in `utils/camera-video.ts`, tested). The timer button still delays the START. The clip is copied to `pending_uploads` like a photo, and handed to `onCapture` as `{ uri, fileName, type: 'video/mp4' | 'video/quicktime', width, height, duration }`. Preview plays it with `react-native-video` (`Use Video`).
- ⚠️ **No host passes `allowVideo` yet.** Every current consumer (`TagPhotoModal`, `DynamicInspectionView`, `JobDocsSection`) feeds the asset into an image-only pipeline (tagging, annotation, thumbnails, the pending-upload queue) and the lead-photo endpoint is not known to accept video. Turn it on per flow only after that flow handles `type.startsWith('video/')`.
- Mic: `Camera.requestMicrophonePermission()` is asked when recording starts; a denial records a SILENT clip (`audio={isVideoMode && micGranted}`), it does not block. Closing the camera mid-recording calls `cancelRecording()`. Not verified on device (no jest for RN components).
- Update: `TagPhotoModal` now passes `allowVideo` (see `lead-center.md`); the "No host passes `allowVideo`" warning above applies to the other flows.
- **`widgets/common/PreviewMedia.tsx`** (new): `<Video>` when `type` starts with `video/`, else `<Image>`; paused first frame unless `controls`. ⚠️ Use it for any preview of a CAMERA capture - `<Image>` renders nothing for a video file. `TagPhotoModal` and `DynamicInspectionView` both pass `allowVideo` to the camera now (details and open risks in `lead-center.md`); `JobDocsSection`'s "Start Taking Photos" reaches `DynamicInspectionView` when the company has an inspection schema, else `TagPhotoModal`.
