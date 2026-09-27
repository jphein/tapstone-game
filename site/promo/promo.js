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
})();
