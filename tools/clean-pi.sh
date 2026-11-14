set -euo pipefail
in="${1:?input file}"; out="${2:-data/pi.txt}"
tr -dc '0-9' < "$in" | tail -c +2 > "$out"      
echo "wrote $(stat -c %s "$out") digits to $out"; head -c 50 "$out"; echo
