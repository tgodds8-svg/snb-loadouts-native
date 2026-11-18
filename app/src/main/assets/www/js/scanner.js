/* SnB Loadouts — Offline Camera & Screenshot Loadout Scanner */
'use strict';

const Scanner = {
  lastMatches: null,

  init() {
    const trigger = document.getElementById('btn-scan-trigger');
    const fileInp = document.getElementById('scan-file-input');
    const closeBtn = document.getElementById('scanner-close');
    const retakeBtn = document.getElementById('scanner-retake');
    const applyBtn = document.getElementById('scanner-apply');
    const modal = document.getElementById('scanner-modal');

    if (trigger && fileInp) {
      trigger.addEventListener('click', () => {
        fileInp.value = '';
        fileInp.click();
      });
      fileInp.addEventListener('change', e => {
        const file = e.target.files && e.target.files[0];
        if (file) this.handleImage(file);
      });
    }

    if (retakeBtn && fileInp) {
      retakeBtn.addEventListener('click', () => {
        fileInp.value = '';
        fileInp.click();
      });
    }

    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => { modal.hidden = true; });
      modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
    }

    if (applyBtn) {
      applyBtn.addEventListener('click', () => this.applyToLoadout());
    }
  },

  /* Preprocess image on an offscreen canvas (grayscale + contrast boost) for TV/monitor glare */
  preprocessImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const maxDim = 1600;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        const contrast = 1.35;
        const intercept = 128 * (1 - contrast);
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const adj = Math.max(0, Math.min(255, gray * contrast + intercept));
          d[i] = d[i + 1] = d[i + 2] = adj;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve({ previewUrl: url, canvas });
      };
      img.onerror = err => reject(err);
      img.src = url;
    });
  },

  /* Levenshtein edit distance & normalized similarity [0..1] */
  similarity(a, b) {
    a = DB.norm(a);
    b = DB.norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const m = a.length;
    const n = b.length;
    if (Math.abs(m - n) > Math.max(m, n) * 0.45) return 0;

    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return 1 - dp[m][n] / Math.max(m, n);
  },

  /* Match extracted OCR text lines against ships, armors, weapons, and furniture */
  matchTextToCatalog(rawText) {
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map(l => l.replace(/[^a-zA-Z0-9\s'\-]/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(l => l.length >= 4);

    // Also test sliding 2-word and 3-word windows in case HUD labels sit on the same line
    const candidates = new Set(lines);
    lines.forEach(line => {
      const words = line.split(' ');
      for (let len = 2; len <= Math.min(5, words.length); len++) {
        for (let i = 0; i <= words.length - len; i++) {
          candidates.add(words.slice(i, i + len).join(' '));
        }
      }
    });

    const findBest = (catalog, threshold = 0.76) => {
      const found = [];
      catalog.forEach(item => {
        if (!item || !item.name) return;
        let bestScore = 0;
        candidates.forEach(cand => {
          const score = this.similarity(cand, item.name);
          if (score > bestScore) bestScore = score;
        });
        if (bestScore >= threshold) {
          found.push({ item, score: Math.round(bestScore * 100) });
        }
      });
      found.sort((a, b) => b.score - a.score);
      // Deduplicate by item name
      const seen = new Set();
      return found.filter(x => {
        const k = DB.norm(x.item.name);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };

    const ships = findBest(DB.ships.filter(s => s.playable !== false), 0.78);
    const armors = findBest(DB.armors, 0.76);
    const weapons = findBest(DB.weapons, 0.76);
    const furniture = findBest(DB.furniture, 0.76);

    return {
      ship: ships[0] || null,
      armor: armors[0] || null,
      weapons: weapons.slice(0, 6),
      majors: furniture.filter(f => (f.item.tier || '').toLowerCase() === 'major').slice(0, 1),
      minors: furniture.filter(f => (f.item.tier || '').toLowerCase() !== 'major').slice(0, 6),
    };
  },

  async handleImage(file) {
    const modal = document.getElementById('scanner-modal');
    const status = document.getElementById('scanner-status');
    const previewWrap = document.getElementById('scanner-preview-wrap');
    const previewImg = document.getElementById('scanner-preview-img');
    const progBox = document.getElementById('scanner-progress');
    const barFill = document.getElementById('scanner-bar-fill');
    const progText = document.getElementById('scanner-progress-text');
    const resultsBox = document.getElementById('scanner-results');
    const applyBtn = document.getElementById('scanner-apply');

    if (!modal) return;
    modal.hidden = false;
    resultsBox.innerHTML = '';
    applyBtn.hidden = true;
    progBox.hidden = false;
    barFill.style.width = '10%';
    progText.textContent = 'Enhancing screen contrast…';

    try {
      const { previewUrl, canvas } = await this.preprocessImage(file);
      previewImg.src = previewUrl;
      previewWrap.hidden = false;

      if (typeof Tesseract === 'undefined') {
        progBox.hidden = true;
        status.innerHTML = '<strong>Offline OCR Engine Missing:</strong> Place <code>tesseract.min.js</code>, <code>worker.min.js</code>, and <code>eng.traineddata.gz</code> inside <code>www/js/ocr/</code> (see Handoff Guide) to enable offline scanning.';
        return;
      }

      progText.textContent = 'Reading loadout text offline…';
      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: 'js/ocr/worker.min.js',
        langPath: 'js/ocr',
        corePath: 'js/ocr',
        logger: m => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            barFill.style.width = Math.round(15 + m.progress * 80) + '%';
          }
        },
      });

      const { data } = await worker.recognize(canvas);
      await worker.terminate();

      barFill.style.width = '100%';
      progBox.hidden = true;

      const matches = this.matchTextToCatalog(data.text);
      this.lastMatches = matches;
      this.renderMatches(matches, resultsBox, status, applyBtn);
    } catch (err) {
      progBox.hidden = true;
      status.textContent = 'Scan failed: ' + (err && err.message ? err.message : 'Unable to read image.');
    }
  },

  renderMatches(m, box, status, applyBtn) {
    const totalFound =
      (m.ship ? 1 : 0) +
      (m.armor ? 1 : 0) +
      m.weapons.length +
      m.majors.length +
      m.minors.length;

    if (!totalFound) {
      status.textContent = 'No matching Skull & Bones items detected. Try zooming closer to your loadout cards with less glare.';
      return;
    }

    status.textContent = `Detected ${totalFound} item(s). Review below before applying to your loadout:`;
    const cards = [];

    if (m.ship) {
      cards.push(`<div class="scan-match-card">
        <div class="scan-match-top"><span class="scan-tag">⛵ Warship</span><span class="scan-conf">${m.ship.score}% match</span></div>
        <div><strong>${esc(m.ship.item.name)}</strong></div>
      </div>`);
    }
    if (m.armor) {
      cards.push(`<div class="scan-match-card">
        <div class="scan-match-top"><span class="scan-tag">🛡️ Hull Armor</span><span class="scan-conf">${m.armor.score}% match</span></div>
        <div><strong>${esc(m.armor.item.name)}</strong></div>
      </div>`);
    }
    m.weapons.forEach((w, idx) => {
      cards.push(`<div class="scan-match-card">
        <div class="scan-match-top"><span class="scan-tag">⚔️ Weapon ${idx + 1}</span><span class="scan-conf">${w.score}% match</span></div>
        <div><strong>${esc(w.item.name)}</strong> <span class="hint">(${esc(w.item.slot || 'any')})</span></div>
      </div>`);
    });
    m.majors.forEach(f => {
      cards.push(`<div class="scan-match-card">
        <div class="scan-match-top"><span class="scan-tag">★ Major Furniture</span><span class="scan-conf">${f.score}% match</span></div>
        <div><strong>${esc(f.item.name)}</strong></div>
      </div>`);
    });
    m.minors.forEach((f, idx) => {
      cards.push(`<div class="scan-match-card">
        <div class="scan-match-top"><span class="scan-tag">🪑 Minor Furniture ${idx + 1}</span><span class="scan-conf">${f.score}% match</span></div>
        <div><strong>${esc(f.item.name)}</strong></div>
      </div>`);
    });

    box.innerHTML = cards.join('');
    applyBtn.hidden = false;
  },

  applyToLoadout() {
    const m = this.lastMatches;
    if (!m) return;

    if (m.ship) {
      S.loadout = newLoadout(m.ship.item.name);
    } else if (!S.loadout) {
      const fallbackShip = (DB.ships.find(s => s.playable !== false) || { name: 'Frigate' }).name;
      S.loadout = newLoadout(fallbackShip);
    }

    ensureMinorSlots();

    if (m.armor) {
      S.loadout.armor = m.armor.item;
    }

    // Assign detected weapons into compatible empty slots first
    m.weapons.forEach(wObj => {
      const w = wObj.item;
      const compat = DB.weaponsForSlot ? null : [];
      const slot = S.loadout.weaponSlots.find(sl => {
        if (sl.weapon) return false;
        const allowed = DB.weaponsForSlot(sl.position);
        return allowed.some(a => a.name === w.name);
      });
      if (slot) {
        slot.weapon = w;
      }
    });

    if (m.majors.length && S.loadout.furniture[0]) {
      S.loadout.furniture[0].item = m.majors[0].item;
    }

    let minorIdx = 0;
    S.loadout.furniture.forEach(f => {
      if (f.kind === 'minor' && minorIdx < m.minors.length) {
        f.item = m.minors[minorIdx++].item;
      }
    });

    const modal = document.getElementById('scanner-modal');
    if (modal) modal.hidden = true;

    if (typeof switchTab === 'function') switchTab('build');
    if (typeof switchSubView === 'function') switchSubView('deck');
    if (typeof renderBuildAll === 'function') renderBuildAll();
  },
};

window.Scanner = Scanner;
