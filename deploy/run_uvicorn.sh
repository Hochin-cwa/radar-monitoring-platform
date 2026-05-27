if ps -ef |grep backend |grep monitor|grep -v grep ;then
  kill -9 $( ps -ef |grep backend |grep monitor|grep -v grep|awk '{print $2}' )
  sleep 5
fi
cd ../
nohup uvicorn backend.main:app --host 0.0.0.0 --port 8000 > logs/uvicorn.log 2>&1 &

