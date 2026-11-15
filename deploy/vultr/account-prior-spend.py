# Conservative one-time reservation for requests made before the dollar ledger existed.
# Uses persisted counters, not guessed invoices. No provider API calls; never resets counters.
import sqlite3,json
ledger=sqlite3.connect('/var/lib/wisprno-spend/budget.sqlite')
ledger.execute('CREATE TABLE IF NOT EXISTS migrations(id TEXT PRIMARY KEY,details TEXT NOT NULL)')
ledger.execute('BEGIN IMMEDIATE')
if not ledger.execute("SELECT 1 FROM migrations WHERE id='prior-request-reservations-v1'").fetchone():
 target=sqlite3.connect('file:/var/lib/wisprno-target/target.sqlite?mode=ro',uri=True).execute('SELECT requests FROM budget WHERE id=1').fetchone()[0]
 harness=json.load(open('/var/lib/wisprno/harness-budget.json'))['requests']
 # Target: <=64KB, 1000 output, gpt-4.1-mini. Harness: <=32KB,1000 output, highest configured gpt-4.1 price.
 micros=target*31200+harness*92000
 if ledger.execute("UPDATE budgets SET reserved=reserved+? WHERE provider='openai' AND reserved+?<=cap",(micros,micros)).rowcount!=1:raise RuntimeError('Prior usage exceeds cap; paid work must remain locked')
 details=json.dumps({'targetRequests':target,'harnessAttempts':harness,'conservativeReservedUsd':micros/1e6})
 ledger.execute("INSERT INTO migrations VALUES('prior-request-reservations-v1',?)",(details,))
 ledger.execute("INSERT INTO reservations(at,model,micros) VALUES(datetime('now'),'prior-openai-conservative-reservation',?)",(micros,))
 print(details)
else:print('Prior usage already reserved; unchanged')
ledger.commit()
