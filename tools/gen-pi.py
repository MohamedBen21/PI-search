import sys, time
import gmpy2
from gmpy2 import mpz

def bs(a, b):

    if b - a == 1:
        if a == 0:
            Pab = Qab = mpz(1)
        else:
            Pab = mpz((6 * a - 5) * (2 * a - 1) * (6 * a - 1))
            Qab = mpz(a * a * a * 10939058860032000)  
        Tab = Pab * (13591409 + 545140134 * a)
        if a & 1:
            Tab = -Tab
        return Pab, Qab, Tab
    m = (a + b) // 2
    Pam, Qam, Tam = bs(a, m)
    Pmb, Qmb, Tmb = bs(m, b)
    return Pam * Pmb, Qam * Qmb, Qmb * Tam + Pam * Tmb

def pi_digits(n):
    guard = 20
    terms = int(n / 14.181647462725477) + 2
    t0 = time.time()
    P, Q, T = bs(0, terms)
    print(f"binary splitting done in {time.time()-t0:.1f}s", file=sys.stderr)
    one = mpz(10) ** (n + guard)
    sqrt_c = gmpy2.isqrt(10005 * one * one)
    pi = (Q * 426880 * sqrt_c) // T
    s = str(pi)            
    return s[1:n + 1]      

if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10_000_000
    out = sys.argv[2] if len(sys.argv) > 2 else "data/pi.txt"
    t = time.time()
    d = pi_digits(n)
    with open(out, "w") as f:
        f.write(d)
    print(f"wrote {len(d):,} digits to {out} in {time.time()-t:.1f}s", file=sys.stderr)
