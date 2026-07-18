// Shared chart-rendering utilities for report generation (canvas → PNG dataURL).
// Brand palette: ink #17171A, coral #E8332E accent, teal #0E8C8C, amber, green.

const C = { ink: "#17171a", coral: "#e8332e", teal: "#0e8c8c", grey: "#6d6d76", line: "#d9d9de", green: "#2f855a", amber: "#b7791f" };

export function donutChart(score, band) {
  const s = 360, c = document.createElement("canvas"); c.width = s; c.height = s;
  const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, s, s);
  const cx = s / 2, cy = s / 2, r = 130, w = 34;
  const col = score < 40 ? C.coral : score < 70 ? C.amber : C.green;
  x.lineWidth = w; x.lineCap = "round";
  x.strokeStyle = "#ececf0";
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = col;
  x.beginPath(); x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.min(100, score) / 100) * Math.PI * 2); x.stroke();
  // 70 benchmark tick
  const a = -Math.PI / 2 + 0.7 * Math.PI * 2;
  x.strokeStyle = C.coral; x.lineWidth = 4;
  x.beginPath(); x.moveTo(cx + Math.cos(a) * (r - w / 2 - 6), cy + Math.sin(a) * (r - w / 2 - 6));
  x.lineTo(cx + Math.cos(a) * (r + w / 2 + 6), cy + Math.sin(a) * (r + w / 2 + 6)); x.stroke();
  x.fillStyle = C.ink; x.font = "bold 78px Arial"; x.textAlign = "center"; x.fillText(String(score), cx, cy + 14);
  x.fillStyle = C.grey; x.font = "bold 22px Arial"; x.fillText((band || "").toUpperCase(), cx, cy + 52);
  return c.toDataURL("image/png");
}

// rows: [{ label, counts: { pos, neu, neg, dkna } }] — a stacked 100% bar each.
export function distBarChart(rows) {
  const rh = 52, W = 920, L = 210, BW = 560;
  const c = document.createElement("canvas"); c.width = W; c.height = rows.length * rh + 58;
  const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  rows.forEach((r, i) => {
    const y = 18 + i * rh, tot = Math.max(1, r.counts.pos + r.counts.neu + r.counts.neg + r.counts.dkna);
    x.fillStyle = C.ink; x.font = "bold 15px Arial"; x.textAlign = "left";
    x.fillText(r.label.length > 24 ? r.label.slice(0, 23) + "…" : r.label, 12, y + 17);
    let bx = L;
    const seg = (n, col) => {
      const wpx = (n / tot) * BW;
      if (wpx > 0.5) {
        x.fillStyle = col; x.fillRect(bx, y, wpx, 24);
        if (wpx > 34) { x.fillStyle = "#fff"; x.font = "bold 12px Arial"; x.textAlign = "center"; x.fillText(Math.round((n / tot) * 100) + "%", bx + wpx / 2, y + 16); }
      }
      bx += wpx;
    };
    seg(r.counts.pos, C.green); seg(r.counts.neu, C.amber); seg(r.counts.neg, C.coral); seg(r.counts.dkna, "#b9b9c2");
    x.fillStyle = C.grey; x.font = "12px Arial"; x.textAlign = "left"; x.fillText(`n=${tot}`, L + BW + 12, y + 16);
  });
  const ly = c.height - 20;
  const leg = [["Agree", C.green], ["Neutral", C.amber], ["Disagree", C.coral], ["Don't know / N-A", "#b9b9c2"]];
  let lx = L;
  x.font = "13px Arial";
  leg.forEach(([t, col]) => { x.fillStyle = col; x.fillRect(lx, ly - 10, 12, 12); x.fillStyle = C.grey; x.textAlign = "left"; x.fillText(t, lx + 17, ly + 1); lx += x.measureText(t).width + 50; });
  return c.toDataURL("image/png");
}

// Aggregate a pillar's answer distribution across visible groups from detail questions.
export function pillarDistribution(questions, pillarId, visibleTypes) {
  const counts = { pos: 0, neu: 0, neg: 0, dkna: 0 };
  for (const q of questions || []) {
    if (q.pillar !== pillarId) continue;
    for (const t of visibleTypes) {
      const d = q.groups?.[t]?.dist; if (!d) continue;
      counts.pos += (d.sa || 0) + (d.a || 0);
      counts.neu += d.n || 0;
      counts.neg += (d.d || 0) + (d.sd || 0);
      counts.dkna += (d.dk || 0) + (d.na || 0);
    }
  }
  return counts;
}
