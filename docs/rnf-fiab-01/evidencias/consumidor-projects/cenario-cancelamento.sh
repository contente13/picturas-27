#!/bin/bash
R=$(dirname $0)/rmq.sh; API=http://localhost:15672/api; A="-s -u $RMQ_AUTH"
echo "== 1. estado inicial"; for i in $(seq 1 30); do $R qinfo | grep -q consumers=1 && break; sleep 1; done; $R qinfo; $R conns
echo "== 2. apagar project_queue (o broker cancela o consumidor; a ligação continua aberta)"
curl $A -X DELETE "$API/queues/%2F/project_queue" -o /dev/null -w 'delete %{http_code}\n'
for t in 2 4 6 8 10 15 20 30; do sleep $([ $t -le 10 ] && echo 2 || echo 5); echo "t~${t}s: $($R qinfo)"; done
echo "binding: $(curl $A "$API/queues/%2F/project_queue/bindings" | python3 -c "import json,sys;print([(b['source'],b['routing_key']) for b in json.load(sys.stdin) if b['source']])")"
$R conns
echo "== 3. mensagem publicada no exchange picturas"
curl $A -X POST -H 'content-type: application/json' "$API/exchanges/%2F/picturas/publish" -d '{"properties":{"delivery_mode":2},"routing_key":"project_queue","payload":"{\"messageId\":\"fixtest-probe\",\"status\":\"success\"}","payload_encoding":"string"}'; echo
sleep 3; curl $A "$API/queues/%2F/project_queue" | python3 -c "import json,sys;d=json.load(sys.stdin);print('ready=%s unacked=%s consumers=%s'%(d['messages_ready'],d['messages_unacknowledged'],d['consumers']))"
