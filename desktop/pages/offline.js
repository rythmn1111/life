const q = new URLSearchParams(location.search);
document.getElementById("detail").textContent = `${q.get("server") || "No server"}: ${q.get("reason") || "no answer"}`;
document.getElementById("retry").addEventListener("click", () => window.lifeDesktop.retry());
document.getElementById("change").addEventListener("click", () => location.assign("setup.html"));
setInterval(() => window.lifeDesktop.retry(), 10_000);
