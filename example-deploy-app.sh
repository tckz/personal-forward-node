#!/bin/bash

tmp_app_yaml=app-tmp.$$.yaml

function cleanup() {
	if [[ -f $tmp_app_yaml ]]
	then
		/bin/rm -f $tmp_app_yaml
	fi
}

trap cleanup EXIT

npm run dist && (cat <<EOF > $tmp_app_yaml
runtime: nodejs12

service: somesvcname

# Use only a single instance, so that this local-memory-only chat app will work
# consistently with multiple users. To work across multiple instances, an
# extra-instance messaging system or data store would be needed.
#manual_scaling:
#  instances: 1

#resources:
#  cpu: 1
#  memory_gb: 0.7

automatic_scaling:
  max_instances: 1
  max_concurrent_requests: 80
  target_cpu_utilization: 0.95

network:
  session_affinity: true

env_variables:
 #IAP_CLIENT_ID: "xxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
EOF
) && gcloud app deploy --project some-pj -q $tmp_app_yaml

