#!/bin/bash
# Helper for the RabbitMQ management API of the local test stack.
API=http://localhost:15672/api
: "${RMQ_AUTH:?set RMQ_AUTH=<user>:<password> (RabbitMQ of docker-compose.yaml)}"
A="-s -u $RMQ_AUTH"
case "$1" in
  qinfo) curl $A "$API/queues/%2F/project_queue" | python3 -c "import json,sys;d=json.load(sys.stdin);print('consumers=%s args=%s'%(d.get('consumers'),d.get('arguments')) if 'name' in d else d)";;
  conns) curl $A "$API/connections" | python3 -c "
import json,sys;cs=json.load(sys.stdin)
print('connections=%d'%len(cs), sorted(c['peer_host'] for c in cs))";;
  consumers) curl $A "$API/consumers" | python3 -c "
import json,sys;cs=json.load(sys.stdin)
print('consumers(all queues)=%d'%len(cs), [c['queue']['name'] for c in cs])";;
  breakq)  curl $A -X DELETE "$API/queues/%2F/project_queue" -o /dev/null -w 'delete %{http_code}\n'
           curl $A -X PUT -H 'content-type: application/json' "$API/queues/%2F/project_queue" -d '{"durable":true,"arguments":{"x-max-length":1}}' -o /dev/null -w 'redeclare-bad %{http_code}\n';;
  fixq)    curl $A -X DELETE "$API/queues/%2F/project_queue" -o /dev/null -w 'delete %{http_code}\n'
           curl $A -X PUT -H 'content-type: application/json' "$API/queues/%2F/project_queue" -d '{"durable":true,"arguments":{}}' -o /dev/null -w 'redeclare-ok %{http_code}\n'
           curl $A -X POST -H 'content-type: application/json' "$API/bindings/%2F/e/picturas/q/project_queue" -d '{"routing_key":"project_queue"}' -o /dev/null -w 'bind %{http_code}\n';;
  killconns) curl $A "$API/connections" | python3 -c "import json,sys,urllib.parse;[print(urllib.parse.quote(c['name'],safe='')) for c in json.load(sys.stdin)]" | while read n; do curl $A -X DELETE "$API/connections/$n" -o /dev/null -w "close-conn %{http_code}\n"; done;;
esac
