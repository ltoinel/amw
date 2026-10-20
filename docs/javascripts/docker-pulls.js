/*
 * Shows the Docker Hub pull count next to the GitHub facts in the header,
 * styled like Material's own repository facts.
 *
 * The Docker Hub API sends no CORS headers, so browsers cannot read it from
 * this site; shields.io exposes the same figure (already formatted, e.g.
 * "1.3k") with CORS allowed. The value is cached per tab in sessionStorage to
 * avoid one request per page with instant navigation. Any failure (blocked
 * request, privacy extension, storage disabled) just leaves the block without
 * a count.
 */
(function () {
  "use strict";

  var CACHE_PREFIX = "amw-docker-pulls:";

  function readCache(image) {
    try {
      return sessionStorage.getItem(CACHE_PREFIX + image);
    } catch (error) {
      return null;
    }
  }

  function writeCache(image, value) {
    try {
      sessionStorage.setItem(CACHE_PREFIX + image, value);
    } catch (error) {
      /* storage unavailable: the next page fetches again */
    }
  }

  function render(link, pulls) {
    var repository = link.querySelector(".md-source__repository");
    if (!repository || repository.querySelector(".md-source__facts")) {
      return;
    }
    var facts = document.createElement("ul");
    facts.className = "md-source__facts";
    var fact = document.createElement("li");
    fact.className = "md-source__fact md-source__fact--pulls";
    fact.textContent = pulls + " pulls";
    facts.appendChild(fact);
    repository.appendChild(facts);
    repository.classList.add("md-source__repository--active");
  }

  function load(link) {
    var image = link.getAttribute("data-amw-docker-image");
    var cached = readCache(image);
    if (cached) {
      render(link, cached);
      return;
    }
    fetch("https://img.shields.io/docker/pulls/" + image + ".json")
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (badge) {
        // shields.io answers 200 with an error message when Docker Hub fails
        if (badge && typeof badge.value === "string" && /^[0-9][0-9.,]*[kMG]?$/.test(badge.value)) {
          writeCache(image, badge.value);
          render(link, badge.value);
        }
      })
      .catch(function () {
        /* offline or blocked: keep the block without a count */
      });
  }

  function init() {
    document.querySelectorAll("[data-amw-docker-image]").forEach(load);
  }

  // Material re-renders the page on instant navigation and announces it through
  // the document$ observable; fall back to a plain load event without it.
  if (typeof document$ !== "undefined") {
    document$.subscribe(init);
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
