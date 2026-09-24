"""Reproducible LOCAL ONLY proof runner. Never accepts arbitrary input or URLs."""
import argparse
import hashlib
import json
from pathlib import Path
import socket
import sqlite3
import tempfile
from unittest.mock import Mock, patch
from datetime import datetime, timezone
from issuer_adapter import StagingIssuerResolver
from send_proof import canonical_sha256
from synthetic_fixture import actual_fixture as fixture
from test_issuer_adapter import load


def run(output):
    result = {'schema':'a17-uploader-local-dryrun-v1','mode':'test_only','provenance':'SYNTHETIC_LOCAL_ONLY',
              'external_requests':0,'platform_acceptance_observed':False,'attribution_observed':False,
              'money_reporting_eligible':False,'payloads':[]}
    with tempfile.TemporaryDirectory() as directory, patch('socket.socket.connect', side_effect=AssertionError('NETWORK_FORBIDDEN')) as network, patch('socket.getaddrinfo', side_effect=AssertionError('DNS_FORBIDDEN')) as dns:
        root = Path(directory)
        for platform in ('meta','microsoft'):
            database=root/(platform+'-issuer.sqlite'); ledger=root/(platform+'-ledger.sqlite')
            row, now, setup, records = fixture(platform, database)
            resolver = StagingIssuerResolver(database, clock=lambda:now)
            if platform == 'meta':
                module = load('a17_meta_evidence', 'meta/sender.py')
                payload = module.build_request(row, now=now//1000, offline=True, resolver=resolver)
                transport = module.OfflineTransport()
                receipt = module.dispatch(row, ledger=ledger, transport=transport, now=now//1000, offline=True, resolver=resolver)
                simulated = transport.calls
                target = {'dataset_id':module.offline_target(resolver),'test_event_code':'OFFLINE_ONLY','real_events_manager_code':False}
                table='events'
            else:
                module = load('a17_ms_evidence', 'microsoft/uploader.py')
                moment = datetime.fromtimestamp(now/1000, timezone.utc)
                request = module.prepare(row, setup, moment, resolver=resolver)
                payload = request['body']
                transport = Mock(return_value={'PartialErrors':[]})
                receipt = module.run_test_only(row, setup, ledger, moment, transport, resolver=resolver)
                simulated = transport.call_count
                target = {'account_id':module.ACCOUNT,'goal_id':module.proof_target(row,setup),'real_goal':False}
                table='exports'
            assert simulated == 1 and resolver.calls == 3
            with sqlite3.connect(ledger) as db:
                states=[r[0] for r in db.execute('SELECT state FROM '+table)]
            fresh = resolver.resolve_current(platform,row['proof']['permission_ref'],row['probe_ref'],row['proof']['consent_receipt_id'])
            assert fresh['permission'] == records['permission']
            result['payloads'].append({'platform':platform,'target':target,'payload':payload,
                'payload_sha256':canonical_sha256(payload),'permission_sha256':row['permission_sha256'],
                'source_sha256':records['probe']['source_sha256'],'consent_sha256':records['probe']['consent_sha256'],
                'records':records,'source_row':row,'local_ledger_states':states,'local_simulated_transport_calls':simulated,
                'resolver_reads_preparation_preflight_send':3,'receipt':receipt})
        assert not network.called and not dns.called
        result['socket_connect_attempts']=network.call_count
        result['dns_attempts']=dns.call_count
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True, allow_nan=False)+'\n')
    return result

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args=parser.parse_args()
    result=run(args.output)
    print(json.dumps({'payload_count':len(result['payloads']),'external_requests':result['external_requests'],'output':str(args.output)},sort_keys=True))
