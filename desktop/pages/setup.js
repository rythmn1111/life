const form = document.getElementById("form");
const input = document.getElementById("server");
const error = document.getElementById("error");
const go = document.getElementById("go");

window.lifeDesktop.getServer().then((s) => {
  if (s) input.value = s;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.textContent = "";
  go.disabled = true;
  const r = await window.lifeDesktop.setServer(input.value);
  if (r.error) {
    error.textContent = r.error;
    go.disabled = false;
  }
});
