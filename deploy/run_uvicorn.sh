#kill -9 $( ps -ef |grep uvicorn |grep monitor|grep -v grep|awk '{print $2}' )
#sleep 5
cd ../
echo $PWD
nohup uvicorn backend.main:app --host 0.0.0.0 --port 8000 > logs/uvicorn.log 2>&1 &

