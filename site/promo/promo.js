// When a picture is missing, show its description in a framed panel instead of a broken image.
(function () {
  function mark(img) {
    var fig = img.closest(".art");
    if (fig) {
      fig.setAttribute("data-alt", img.alt);
      fig.classList.add("missing");
    } else {
      img.classList.add("missing");
    }
  }
  document.querySelectorAll("img").forEach(function (img) {
    // decode() rejects for a broken image, loaded or not; naturalWidth is unreliable for viewBox-only SVGs.
    img.addEventListener("error", function () { mark(img); });
    if (img.complete) img.decode().catch(function () { mark(img); });
  });

  // The promo video: site/media/ is deployed separately (site/README.md). When its poster doesn't load,
  // the media aren't there, so the frame shows its description instead of an empty player. A source
  // that fails once someone presses play does the same.
  document.querySelectorAll(".film-frame video").forEach(function (video) {
    var fig = video.closest(".film-frame");
    function missing() { fig.classList.add("missing"); }
    var poster = new Image();
    poster.onerror = missing;
    poster.src = video.getAttribute("poster");
    var sources = video.querySelectorAll("source");
    if (sources.length) sources[sources.length - 1].addEventListener("error", missing);
  });
})();
