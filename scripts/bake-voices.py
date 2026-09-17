"""MEN SOUND LIKE MEN (it.115): bake the human voice banks (public/assets/audio/voices).

No human voice pack exists in any drop, so the hurt / battle-cry / death takes
are cut out of the Horror SFX pack's HUMAN recordings only (Injured, the two
Character gasps, Scream, Distant Yell). Men: tape-pitched down with the
spectral envelope put back at 0.88x (a man, not a slowed-down monster).
Women: near their own pitch. 22 kHz mono 16-bit WAV, RMS-normalised.
Run: python scripts/bake-voices.py
"""
import wave, os
import numpy as np
def load(p):
    w=wave.open(p); n=w.getnframes(); ch=w.getnchannels(); sw=w.getsampwidth(); sr=w.getframerate()
    raw=w.readframes(n)
    if sw==2: a=np.frombuffer(raw,np.int16).astype(np.float32)/32768
    elif sw==3:
        b=np.frombuffer(raw,np.uint8).reshape(-1,3); a=(b[:,0].astype(np.int32)|(b[:,1].astype(np.int32)<<8)|(b[:,2].astype(np.int32)<<16)); a=np.where(a>=1<<23,a-(1<<24),a).astype(np.float32)/(1<<23)
    elif sw==4: a=np.frombuffer(raw,np.int32).astype(np.float32)/2**31
    else: a=(np.frombuffer(raw,np.uint8).astype(np.float32)-128)/128
    a=a.reshape(-1,ch).mean(1); return a,sr,ch,sw
def f0s(a,sr):
    fr=int(0.04*sr); hop=fr//2; out=[]
    for i in range(0,len(a)-fr,hop):
        x=a[i:i+fr]; 
        if np.sqrt((x**2).mean())<0.03: continue
        x=x-x.mean(); c=np.correlate(x,x,'full')[fr-1:]
        lo=int(sr/500); hi=int(sr/70)
        k=lo+np.argmax(c[lo:hi]); 
        if c[k]>0.4*c[0]: out.append(sr/k)
    return out
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets', 'audio')
H = os.path.join(ROOT, 'Horror SFX Free')
OUT = os.path.join(ROOT, 'voices')
os.makedirs(OUT, exist_ok=True)
SR = 22050
src = {
  'injured': os.path.join(H, 'Monsters & Ghosts', 'Injured.wav'),
  'gasp': os.path.join(H, 'Character', 'Gasp.wav'),
  'gasp3': os.path.join(H, 'Character', 'Gasp_3.wav'),
  'scream': os.path.join(H, 'Ambient', 'Scream.wav'),
  'yell': os.path.join(H, 'Ambient', 'Distant Yell_Echo and Reverb_2.wav'),
}
cache = {}
def get(name):
    if name not in cache:
        a, sr, _, _ = load(src[name]); cache[name] = (a.astype(np.float64), sr)
    return cache[name]
def lowpass(a, sr, fc):
    if fc >= sr * 0.49: return a
    n = 101; k = np.arange(n) - (n - 1) / 2
    h = np.sinc(2 * fc / sr * k) * np.hamming(n); h /= h.sum()
    return np.convolve(a, h, mode='same')
def formant_fix(y, ratios, q):
    """Undo the tape shift on the spectral envelope: formants end at q x the source's."""
    n = 1024; hop = 256; win = np.hanning(n)
    pad = np.concatenate([np.zeros(n), y, np.zeros(n)])
    out = np.zeros_like(pad); wsum = np.zeros_like(pad)
    f = np.fft.rfftfreq(n, 1 / SR)
    lif = int(SR / 900)  # lifter below the highest pitch period present
    for i in range(0, len(pad) - n, hop):
        fr = pad[i:i + n] * win
        X = np.fft.rfft(fr); mag = np.abs(X) + 1e-9
        c = np.fft.irfft(np.log(mag), n)
        c[lif:n - lif] = 0
        env = np.exp(np.fft.rfft(c, n).real)
        k = min(len(ratios) - 1, max(0, i + n // 2 - n))
        s_ = ratios[k] / q  # desired env(f) = env_y(f * p / q)
        want = np.interp(np.minimum(f * s_, f[-1]), f, env)
        gain = np.clip(want / env, 0.1, 8.0)
        Y = np.fft.irfft(X * gain, n) * win
        out[i:i + n] += Y; wsum[i:i + n] += win ** 2
    out = out / np.maximum(wsum, 1e-3)
    return out[n:n + len(y)]
def render(name, t0, t1, r0, r1=None, fade_in=0.008, fade_out=0.06, max_len=None, q=None):
    """Tape-style resample of [t0,t1] s: pitch ratio r0 sagging linearly to r1."""
    a, sr = get(name); r1 = r0 if r1 is None else r1
    seg = a[int(t0 * sr):int(t1 * sr)]
    rmax = max(r0, r1)
    seg = lowpass(seg, sr, 0.45 * SR / rmax)
    dur_src = len(seg) / sr
    pos = []; t = 0.0
    while t < dur_src:
        pos.append(t); frac = t / dur_src
        t += (r0 + (r1 - r0) * frac) / SR
    pos = np.array(pos)
    out = np.interp(pos, np.arange(len(seg)) / sr, seg)
    if q is not None:
        ratios = r0 + (r1 - r0) * (pos / dur_src)
        out = formant_fix(out, ratios, q)
    if max_len and len(out) > int(max_len * SR): out = out[:int(max_len * SR)]
    # trim leading/trailing silence
    env = np.abs(out); thr = env.max() * 0.03
    idx = np.where(env > thr)[0]
    out = out[max(0, idx[0] - int(0.005 * SR)):min(len(out), idx[-1] + int(0.03 * SR))]
    fi = int(fade_in * SR); fo = min(int(fade_out * SR), len(out) // 3)
    out[:fi] *= np.linspace(0, 1, fi); out[-fo:] *= np.linspace(1, 0, fo)
    return out
def cat(*parts, gap=0.02):
    z = np.zeros(int(gap * SR)); res = []
    for p in parts: res += [p, z]
    return np.concatenate(res[:-1])
def norm(out, rms_target=0.16, peak=0.92):
    act = out[np.abs(out) > np.abs(out).max() * 0.05]
    rms = np.sqrt((act ** 2).mean()); g = rms_target / max(rms, 1e-6)
    g = min(g, peak / np.abs(out).max()); return out * g
def write(fn, out):
    out = np.clip(out, -1, 1); p = os.path.join(OUT, fn)
    with wave.open(p, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((out * 32767).astype(np.int16).tobytes())
    f = f0s(out.astype(np.float32), SR)
    print(f"{fn}: {len(out)/SR:.2f}s {os.path.getsize(p)//1024}KB f0med={np.median(f) if f else 0:.0f} voiced={len(f)}")
def job(fn, fn_render, rms=0.16): write(fn, norm(fn_render(), rms))
# ---- MEN ----
job('man_hurt_1.wav', lambda: render('injured', 0.0, 0.40, 0.70, q=0.88))
job('man_hurt_2.wav', lambda: render('injured', 0.0, 0.40, 0.60, 0.55, q=0.88))
job('man_hurt_3.wav', lambda: render('gasp', 0.03, 0.50, 0.78, q=0.88), 0.12)
job('man_hurt_4.wav', lambda: render('gasp3', 0.02, 0.32, 0.72, q=0.88), 0.12)
job('man_hurt_5.wav', lambda: render('yell', 0.38, 0.62, 0.62, 0.56, fade_out=0.08, q=0.88))
job('man_cry_1.wav', lambda: render('yell', 0.20, 1.30, 0.62, 0.58, fade_out=0.25, q=0.88))
job('man_cry_2.wav', lambda: render('yell', 0.36, 0.96, 0.55, 0.52, fade_out=0.18, q=0.88))
job('man_cry_3.wav', lambda: render('yell', 0.70, 1.25, 0.66, 0.60, fade_out=0.15, q=0.88))
job('man_die_1.wav', lambda: render('scream', 0.03, 1.80, 0.60, 0.50, fade_out=0.45, max_len=2.4, q=0.88))
job('man_die_2.wav', lambda: render('yell', 0.22, 2.30, 0.60, 0.44, fade_out=0.6, max_len=2.6, q=0.88))
job('man_die_3.wav', lambda: cat(render('injured', 0.0, 0.40, 0.55, 0.48, q=0.88), 0.6 * render('gasp', 0.03, 0.50, 0.66, fade_out=0.15, q=0.88)))
# ---- WOMEN ----
job('woman_hurt_1.wav', lambda: render('injured', 0.0, 0.40, 1.12, q=1.0))
job('woman_hurt_2.wav', lambda: render('injured', 0.0, 0.40, 1.0, 0.92, q=1.0))
job('woman_hurt_3.wav', lambda: render('gasp', 0.03, 0.50, 1.06, q=1.0), 0.12)
job('woman_hurt_4.wav', lambda: render('gasp3', 0.02, 0.32, 1.12, q=1.0), 0.12)
job('woman_hurt_5.wav', lambda: render('yell', 0.38, 0.62, 1.02, 0.94, fade_out=0.08, q=1.0))
job('woman_cry_1.wav', lambda: render('yell', 0.20, 1.30, 1.0, 0.95, fade_out=0.25, q=1.0))
job('woman_cry_2.wav', lambda: render('yell', 0.36, 0.96, 1.08, 1.0, fade_out=0.18, q=1.0))
job('woman_die_1.wav', lambda: render('scream', 0.03, 1.80, 1.0, 0.9, fade_out=0.35, q=1.0))
job('woman_die_2.wav', lambda: render('scream', 0.03, 1.80, 0.9, 0.78, fade_out=0.4, max_len=2.2, q=1.0))
job('woman_die_3.wav', lambda: render('yell', 0.22, 2.30, 1.0, 0.78, fade_out=0.6, max_len=2.4, q=1.0))
