# Portfolio content handoff

The portfolio draft is `docs/index.html`, styled by `docs/portfolio.css`.
GitHub Pages is published at
https://jerrychan54321-coder.github.io/live-transcription-group-project/.
As checked September 27, its source is **jerry-docker-branch /docs**, while the
review branch is **jerry-peer-feedback-review**. This branch does not update the live site.
Open index.html locally to review. All media paths are relative to docs.

## Content already written

- Problem, product explanation, features, and browser-audio pipeline.
- Four engineering decisions grounded in README.md, docs/report.md, and the Docker work.
- Test results and limitations, distinguishing processing time from end-to-end latency.
- Team contributions from the report, Jerry's Docker work, and Jerry's supplied attribution for Quang's Vietnamese translation idea and Ollama model selection/testing.
- GitHub, Docker Hub, setup-guide, and validation-note links.

## Required before the final portfolio is published

- Three verbatim comments have been added to the local article and
  [peer-feedback.md](peer-feedback.md), using anonymous labels. Peer 3 is accurately
  identified as a demo observer. Jerry explicitly confirmed consent for public GitHub
  sharing of all content in the original evidence document on September 27, 2026,
  including comments, identifying information, and screenshots.
- Independent GUI installation evidence remains limited. Peer 3 follow-up is outside
  this update at Jerry's request; the limitation remains accurately described.
- Quang's placeholder has been replaced in the article and report using Jerry's supplied description; all four members now also appear in README credits.
- Review all other member contributions with the group.
- The existing live demo is 20.1 seconds; the recording demo is 37.4 seconds. Both are
  embedded and accurately labeled. Another group member is creating replacement
  demo footage; that work is outside this update. Update labels/poster when integrating it.
- Verify video playback and page layout in a browser before merging.

## Evidence sources

| Article content | Source |
|---|---|
| Purpose and functionality | README.md and docs/report.md |
| English-first workers, local inference, earlier observations | docs/report.md |
| Browser microphone capture and Docker packaging | Current source and Docker files |
| 22 Python checks and real-model test observations | docs/docker-validation.md |
| Member contributions | docs/report.md; Jerry's packaging/publication work and supplied attribution for Quang |
| Live and recording videos | Existing public repository's demo folder |

The video poster is a frame extracted from the live demo, not a generated app mockup.
Peer comments are verbatim from Peer Usage Comments.docx; identifying headings were
replaced with anonymous numbers. No contribution, benchmark, or consent was invented.

## Files for the portfolio commit

- docs/index.html
- docs/portfolio.css
- docs/.nojekyll
- docs/assets/demo.mp4
- docs/assets/recording-demo.mp4
- docs/assets/demo-poster.jpg
- docs/portfolio-content-checklist.md
- docs/peer-feedback.md
- docs/submission-checklist.md
- README.md and docs/docker-validation.md updates
- Peer Usage Comments.docx (original document, including screenshots; consent for all content explicitly confirmed by Jerry).

Later steps: review jerry-peer-feedback-review, then use the group's review
process to integrate into the branch serving Pages. Pages currently serves
jerry-docker-branch /docs, so updating main alone will not update that page. Verify the
live page after publication. The Pages URL has been added to the local README.
The portfolio does not run the translation backend and does not require ngrok.
