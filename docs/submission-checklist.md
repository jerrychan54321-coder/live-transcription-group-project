# Follow-up assignment requirements check

Checked September 27, 2026 against the supplied follow-up assignment text.
This is an evidence audit, not a new functional test run.

**Overall: partially complete.** Packaging and publication are in place, but
peer-trial evidence and several submission details remain incomplete.

| Requirement | Status | Evidence / action |
|---|---|---|
| Dockerfile and container packaging | Present; previously tested | `Dockerfile`, `docker/start.sh`, `docker-compose.yml`; historical checks in `docker-validation.md`. |
| Public Docker Hub release and exact tag | Verified public | `jchan314/classroom-live:1.0.0`; [Docker Hub](https://hub.docker.com/r/jchan314/classroom-live). Linux AMD64; Apple Silicon not verified. |
| Beginner Docker Desktop Search/Pull/Run instructions | Present | `SETUP.md` explains the tag, port mapping, downloads, microphone permissions, troubleshooting, and optional Run-dialog variables. No host Python/Ollama/FFmpeg or API key required. |
| Browser-accessible app | Present | FastAPI/browser UI and browser microphone capture. Desktop X-server requirements do not apply. |
| GUI-only installation on another machine before peer trials | Not established | Screenshots include local source builds using terminals. Record the published-image GUI test, machine, and date; do not infer it happened before the trials. |
| Three peers outside data science/CS using their own laptops | Incomplete | Three comments exist, but Peer 3 watched a demo on a friend's laptop. Further Peer 3 follow-up is outside this update at Jerry's request; the evidence limitation is retained. |
| Peers use Docker Hub GUI installation route | Not established | Build/Compose screenshots do not prove Search/Pull/Run. Record the exact image/tag and GUI installation for each peer. |
| Three honest written comments | Present locally | `peer-feedback.md` preserves all three comments verbatim with anonymous headings. Peer 3's comment is demo feedback, not proof of installation. |
| Peer screenshots/clips | Present locally; incomplete evidence | Root `Peer Usage Comments.docx` includes screenshots and comments. Retained locally and excluded from this public review branch pending explicit permission to publish its identifying screenshots. Anonymous comments are included. Installation-method evidence remains limited. |
| Participant consent | Confirmed by Jerry | On September 27, 2026, Jerry confirmed consent for sharing the supplied peer feedback. The source document includes screenshots and identifying information. |
| Full public GitHub codebase | Verified public | [Repository](https://github.com/jerrychan54321-coder/live-transcription-group-project) includes source, Docker files, setup instructions, and tests. Feedback changes are prepared on the separate review branch; publication to Pages requires integration. |
| README purpose and run instructions | Present | README explains the product, GUI installation, and optional developer setup. Local update adds Pages and evidence links. |
| README license and credits | Present | MIT LICENSE copied unchanged from GitHub main; README links it and lists all four team members. Copyright holder in the supplied license is JOY Q. |
| GitHub Pages article | Verified published | [Portfolio](https://jerrychan54321-coder.github.io/live-transcription-group-project/) returned HTTP 200. GitHub API reports built/public, source `jerry-docker-branch:/docs`. Review branch is `jerry-peer-feedback-review`. |
| Problem, pipeline, engineering decisions/trade-offs | Present | Article covers the problem, staged pipeline, local inference, Docker, and browser audio. |
| Embedded short demo | Present; duration caveat | Two actual MP4s, about 20 and 37 seconds. Public media URLs are reachable. Shorter than the assignment's “a couple of minutes” guidance; actual browser playback still needs review. |
| Peer highlights in article | Added locally | Three comments and synthesis added; Peer 3 labeled a demo observer. The live site still shows the previous pending-feedback text until the serving branch is updated. |
| Each member's specific contribution | Present locally | All four members have descriptions in the article, report, and README. Quang's description reflects Jerry's supplied attribution: Vietnamese translation idea and Ollama model selection/testing. |
| GitHub and Docker Hub links | Present | Both linked in article and README. |
| Portfolio presentation and working media | Partial | Existing layout/assets retained; local HTML references checked. Contribution placeholder replaced; browser layout/playback review not performed in this update. |
| Original functionality and approximately 3-second delay | Partial, historical evidence | Prior tests cover live/recording workflows. One container test reported ~4.9 seconds processing, excluding capture/delivery; ~3-second end-to-end target not demonstrated. Peers report errors and delays. |
| Repository and Pages URLs for submission | Available | Submit both URLs above; no course submission performed here. |
| Backup source ZIP matching pushed code | Missing | No final ZIP found in the project root. Create from the final reviewed/pushed revision and include approved evidence, Docker files, SETUP.md, and image reference. |

## Before Sunday 11:59 p.m.

1. Retain the documented installation-evidence limitations. Peer 3 follow-up is outside this update.
2. Review team credits and the existing MIT copyright attribution.
3. Review the documentation and evidence on jerry-peer-feedback-review through the group's workflow. Update the branch actually served by Pages (`jerry-docker-branch`) or deliberately change Pages settings after review.
4. Verify final public article content and video playback; integrate the replacement demo being produced by the other group member.
5. Create and inspect the backup ZIP from the same final codebase pushed to GitHub; submit it with both URLs.

## Scope and verification

Only README/documentation/portfolio text was edited. Original Word documents
were retained unchanged. No application functions, models, dependencies,
Docker settings, or runtime configuration were changed. This update is prepared for a separate review branch, not a Pages deployment
or course submission. Application tests were not
rerun for this documentation-only update; earlier results remain historical.
