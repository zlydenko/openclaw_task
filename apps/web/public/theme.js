try {
  var savedTheme = localStorage.getItem("openclaw-theme");

  if (savedTheme === "light" || savedTheme === "dark") {
    document.documentElement.dataset.theme = savedTheme;
  }
} catch {
  // Keep the default theme when storage is unavailable.
}
