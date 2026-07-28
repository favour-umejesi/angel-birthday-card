/* Angel's birthday card front-end. Renders wishes, posts new ones. */
(() => {
  const wall = document.getElementById('wall');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');
  const form = document.getElementById('wish-form');
  const messageEl = document.getElementById('message');
  const nameEl = document.getElementById('name');
  const locationEl = document.getElementById('location');
  const charCount = document.getElementById('char-count');
  const errorEl = document.getElementById('form-error');
  const submitBtn = document.getElementById('submit-btn');

  const adminKey = new URLSearchParams(location.search).get('key') || '';
  const TILTS = ['-1.3deg', '0.9deg', '-0.6deg', '1.4deg', '-1deg', '0.5deg'];
  const TONES = ['red', 'blue', 'gold'];
  const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

  let newestId = null;

  function postmarkDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : dateFmt.format(d).replace(',', '').toUpperCase();
  }

  function renderWish(wish, index) {
    const card = document.createElement('article');
    card.className = 'wish';
    card.style.setProperty('--tilt', TILTS[index % TILTS.length]);
    if (wish.id === newestId) card.classList.add('is-new');

    const stamp = document.createElement('span');
    stamp.className = 'wish-stamp';
    stamp.dataset.tone = TONES[(wish.name.length + index) % TONES.length];
    stamp.textContent = (wish.name[0] || '♡').toUpperCase();
    stamp.setAttribute('aria-hidden', 'true');

    const msg = document.createElement('p');
    msg.className = 'wish-msg';
    msg.textContent = wish.message;

    const meta = document.createElement('footer');
    meta.className = 'wish-meta';

    const from = document.createElement('span');
    from.className = 'wish-from';
    from.textContent = `from ${wish.name}`;

    const place = document.createElement('span');
    place.className = 'wish-place';
    const stampDate = postmarkDate(wish.createdAt);
    place.textContent = wish.location ? `${wish.location} · ${stampDate}` : stampDate;

    meta.append(from, place);
    card.append(stamp, msg, meta);

    if (adminKey) {
      const del = document.createElement('button');
      del.className = 'wish-delete';
      del.type = 'button';
      del.textContent = '✕';
      del.title = 'Remove this wish';
      del.addEventListener('click', async () => {
        if (!confirm(`Remove the wish from ${wish.name}?`)) return;
        const res = await fetch(`/api/wishes?id=${encodeURIComponent(wish.id)}`, {
          method: 'DELETE',
          headers: { 'x-admin-key': adminKey }
        });
        if (res.ok) load();
      });
      card.append(del);
    }
    return card;
  }

  function render(wishes) {
    wall.replaceChildren(...wishes.map(renderWish));
    empty.hidden = wishes.length > 0;
    count.textContent =
      wishes.length === 0 ? 'Waiting for the first wish' :
      wishes.length === 1 ? '1 wish so far' :
      `${wishes.length} wishes and counting`;
    newestId = null;
  }

  async function load() {
    try {
      const res = await fetch('/api/wishes');
      if (!res.ok) return;
      const data = await res.json();
      render(data.wishes || []);
    } catch {
      /* offline or server restarting: keep whatever is on screen */
    }
  }

  messageEl.addEventListener('input', () => {
    charCount.textContent = String(messageEl.value.length);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.hidden = true;

    const payload = {
      name: nameEl.value.trim(),
      location: locationEl.value.trim(),
      message: messageEl.value.trim()
    };
    if (!payload.name || !payload.message) {
      errorEl.textContent = !payload.message
        ? 'The wish itself is the important part. Write something!'
        : 'Add your name so Angel knows who this is from.';
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Posting…';
    try {
      const res = await fetch('/api/wishes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');

      newestId = data.wish.id;
      form.reset();
      charCount.textContent = '0';
      submitBtn.textContent = 'Delivered ✓';
      submitBtn.classList.add('is-done');
      await load();
      document.getElementById('wall').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        submitBtn.textContent = 'Post your wish';
        submitBtn.classList.remove('is-done');
        submitBtn.disabled = false;
      }, 2200);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      submitBtn.textContent = 'Post your wish';
      submitBtn.disabled = false;
    }
  });

  load();
  setInterval(load, 45_000); // new wishes appear without a refresh
})();
