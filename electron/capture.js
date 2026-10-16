let sources = [];
let filter = 'all';
function render() {
  const container = document.getElementById('sources');
  container.replaceChildren();
  for (const source of sources.filter(item => filter === 'all' || (filter === 'displays' ? item.display : !item.display))) {
    const button = document.createElement('button');
    button.className = 'source';
    const image = document.createElement('img');
    image.src = source.thumbnail;
    image.alt = '';
    const label = document.createElement('span');
    label.textContent = source.name;
    button.append(image, label);
    button.addEventListener('click', () => window.capture.select(source.id, document.getElementById('system-audio').checked));
    container.append(button);
  }
}
for (const id of ['all', 'displays', 'windows']) document.getElementById(id).addEventListener('click', () => { filter = id; for (const tab of document.querySelectorAll('nav button')) tab.classList.toggle('active', tab.id === id); render(); });
document.getElementById('cancel').addEventListener('click', () => window.capture.select(null));
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.capture.select(null); });
window.capture.sources().then(result => { sources = result; render(); }).catch(() => { document.getElementById('sources').textContent = 'Screen sources are unavailable. Cancel and try again.'; });
