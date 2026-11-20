#!/bin/bash
R=$(dirname $0)/rmq.sh
echo "== 1. estado inicial"; for i in $(seq 1 30); do $R qinfo | grep -q consumers=1 && break; sleep 1; done; $R qinfo; $R conns
echo "== 2. apagar e redeclarar a fila com argumento incompatível"; $R breakq; sleep 3; $R qinfo; $R conns
echo "== 3. fechar a ligação do projects"; $R killconns
for t in 3 6 9 12 15; do sleep 3; echo "t=${t}s: $($R conns | cut -c1-20)"; done
echo "== 5. repor a fila correta"; $R fixq; sleep 8; $R qinfo; $R conns; $R consumers
