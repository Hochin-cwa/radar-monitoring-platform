# 先檢查並釋放 8002 port，再啟動
pkill -f "uvicorn.*8002" || true
sleep 2

cd ../
nohup uvicorn backend.main:app --host 0.0.0.0 --port 8002 > logs/uvicorn.log 2>&1 &
