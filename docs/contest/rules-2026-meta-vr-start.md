# Meta VR Start Developer Competition 2026: the rules that shape Tapstone's entry

Source: the official rules (start-developer-competition-26.devpost.com/rules) and Devpost's welcome email
(2026-09-25), read 2026-09-28. Where a line is quoted, it's the rules' own wording.

## Dates
- **Submission deadline: Wed 2026-11-18, 12:00 PM PT.** You can edit the submission until then; it locks at the deadline.
- Judging runs from about Nov 18 to about Dec 9, and winners are announced around Dec 11.

## Division and track
- **Adapted / Significantly Updated.** Tapstone's engine, arena and cards existed before Sep 24. The headset build (hands-first WebXR, a mixed-reality table, the first five minutes) is the "meaningful new feature, mode, or platform integration shipped during the competition window". Qualifying updates include hand interactions and a mixed-reality mode; bug fixes, cosmetics and performance work alone don't count.
- **Track: Gaming.** "Games designed for hands-first or gaze + hands … genres that thrive seated, without controllers."

## Hard requirements
- **Hands-first:** "fully usable with hands, end-to-end … can someone complete the entire experience without ever pairing a controller?" Tapstone's guard refuses controllers outright (#136).
- **Policy compliance:** the Start terms, Community Standards, Conduct in VR, and the Developer App and Content policies. The content rating must fit ages 10+, 13+ or 18+.
- **Start membership** by the time of submission.

## Design guidelines (these are judged)
- **Seated:** "does every interaction work in a two-foot radius?"
- **Easy in, easy out:** "Fast cold start, clean pause/resume, and something satisfying in 10 minutes or less." Tapstone's spec §3.5 ("Coming back") covers pause and resume.

## What we submit
- **A link judges can open** (IWSDK/WebXR builds): "hosted on GitHub Pages or preferred provider". **GitHub Pages is allowed**, and tapstone-game is public, so it's the simplest host (docs/runbooks/public-hosting.md has Cloudflare Pages as the alternative).
- **A video under 3 minutes**, uploaded publicly to YouTube or Vimeo:
  - "footage of your Project as viewed on a Meta Quest device **or via XR Simulator or another equivalent emulator**".
    Meta XR Simulator is a desktop OpenXR runtime for Unity and Unreal, and it can't host a web page.
    IWER (Meta's WebXR emulator, used by IWSDK) is the equivalent emulator for a WebXR build, so IWER
    footage qualifies. Real Quest footage is still the stronger choice where there is some (quill's
    finding, 2026-09-28);
  - "real gameplay that honestly represents the experience";
  - "Don't lean on AI-generated video" (so no Veo clips);
  - English, or English subtitles;
  - no identifiable person other than entrants (hands-only footage is fine);
  - no advertising or recognisable branded products.
- **A text description:** "your inspiration, how you built it, future plans for improvement and a **target launch date**".
- **Track and division.** "Screenshots, changelogs and/or demo videos are highly recommended."

## Judging (4 × 25%)
1. **Innovation and creativity:** originality, and using device capabilities such as spatial depth and hands-first design.
2. **Experience design:** seated and hands-first use; "Passthrough should be purposeful: the player's real room meaningfully changes the experience"; FoV-aware design.
3. **Technical implementation:** gaze, hand tracking, passthrough, spatial anchoring; "**High-scoring entries must be performant on Meta Quest hardware (min 60 fps)**"; solid and bug-free.
4. **Polish and presentation:** UI/UX, art direction, sound design, and high-quality text, images and video.

## Entrants
- One entry per individual.
- A solo entrant OR a team representative, not both. An organization must be a legal entity and appoint a representative.
- The org question (JP personally vs an organization) is JP's; the Start application's org is on record in the VR spec §9.
