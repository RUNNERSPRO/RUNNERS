import React,{useEffect,useRef,useState}from"react";
import{Alert,Dimensions,SafeAreaView,StatusBar,StyleSheet,Text,TouchableOpacity,View,Modal,Vibration,ScrollView,Platform,Animated}from"react-native";
import*as Location from"expo-location";
import*as TaskManager from"expo-task-manager";
import*as Speech from"expo-speech";
import AsyncStorage from"@react-native-async-storage/async-storage";
import MapView,{Marker,Polyline}from"react-native-maps";
import{Ionicons,FontAwesome5}from"@expo/vector-icons";
import NetInfo from"@react-native-community/netinfo";

const{width,height}=Dimensions.get("window");

const TASK="RUNNER_BACKGROUND_LOCATION";
const SESSION="@runner_active_session_v6";
const HISTORY="@runner_workout_history_v6";

const MAX_ACCURACY=25;
const MIN_MOVE=2;
const MAX_SPEED=22;
const MAX_POINTS=6000;
const DELTA=.0045;

const STOPS=[
 {s:0,c:"#EF4444"},
 {s:4,c:"#FB923C"},
 {s:7,c:"#FACC15"},
 {s:10,c:"#A3E635"},
 {s:13,c:"#22C55E"},
 {s:16,c:"#06B6D4"},
 {s:20,c:"#2563EB"}
];

const mapStyle=[
 {elementType:"geometry",stylers:[{color:"#101411"}]},
 {elementType:"labels.text.fill",stylers:[{color:"#8C948C"}]},
 {elementType:"labels.text.stroke",stylers:[{color:"#101411"}]},
 {featureType:"road",elementType:"geometry",stylers:[{color:"#242A25"}]},
 {featureType:"road.highway",elementType:"geometry",stylers:[{color:"#303832"}]},
 {featureType:"road",elementType:"geometry.stroke",stylers:[{color:"#121612"}]},
 {featureType:"water",elementType:"geometry",stylers:[{color:"#0B1210"}]},
 {featureType:"poi",elementType:"geometry",stylers:[{color:"#172019"}]}
];

function rgb(h){
 h=h.replace("#","");
 return[
  parseInt(h.slice(0,2),16),
  parseInt(h.slice(2,4),16),
  parseInt(h.slice(4,6),16)
 ];
}

function hex(r,g,b){
 return"#"+[r,g,b]
  .map(x=>Math.round(x).toString(16).padStart(2,"0"))
  .join("")
  .toUpperCase();
}

function speedColor(v){
 let s=Math.max(0,Math.min(20,Number(v)||0));

 for(let i=0;i<STOPS.length-1;i++){
  let a=STOPS[i],b=STOPS[i+1];

  if(s>=a.s&&s<=b.s){
   let t=(s-a.s)/(b.s-a.s||1);
   let x=rgb(a.c),y=rgb(b.c);

   return hex(
    x[0]+(y[0]-x[0])*t,
    x[1]+(y[1]-x[1])*t,
    x[2]+(y[2]-x[2])*t
   );
  }
 }

 return STOPS[STOPS.length-1].c;
}

function valid(p){
 return p&&
  Number.isFinite(Number(p.latitude))&&
  Number.isFinite(Number(p.longitude));
}

function coord(p){
 return{
  latitude:Number(p.latitude),
  longitude:Number(p.longitude)
 };
}

function meters(a,b){
 const R=6371000;

 const d1=(b.latitude-a.latitude)*Math.PI/180;
 const d2=(b.longitude-a.longitude)*Math.PI/180;

 const x=
  Math.sin(d1/2)**2+
  Math.cos(a.latitude*Math.PI/180)*
  Math.cos(b.latitude*Math.PI/180)*
  Math.sin(d2/2)**2;

 return 2*R*Math.atan2(
  Math.sqrt(x),
  Math.sqrt(1-x)
 );
}

function timeFmt(s){
 s=Math.max(0,Math.floor(Number(s)||0));

 let h=Math.floor(s/3600);
 let m=Math.floor((s%3600)/60);
 let x=s%60;

 if(h){
  return`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(x).padStart(2,"0")}`;
 }

 return`${String(m).padStart(2,"0")}:${String(x).padStart(2,"0")}`;
}

function pace(d,s){
 if(!d||!s)return"--:--";

 let x=s/d;

 return`${Math.floor(x/60)}:${String(Math.floor(x%60)).padStart(2,"0")}`;
}

function calories(d){
 return Math.round(Math.max(0,Number(d)||0)*65);
}

function direction(h){
 if(!Number.isFinite(Number(h))||h<0)return"--";

 return[
  "N","NE","E","SE",
  "S","SW","W","NW"
 ][Math.floor(h/45+.5)%8];
}

function gps(accuracy){
 if(!Number.isFinite(Number(accuracy)))
  return{t:"SEARCHING",c:"#F59E0B"};

 if(accuracy<=10)
  return{t:"EXCELLENT",c:"#B8FF2C"};

 if(accuracy<=20)
  return{t:"GOOD",c:"#84CC16"};

 if(accuracy<=30)
  return{t:"FAIR",c:"#F59E0B"};

 return{t:"WEAK",c:"#EF4444"};
}

function compact(a){
 return Array.isArray(a)
  ?a.filter(valid).slice(-MAX_POINTS)
  :[];
}


/* =========================================================
   PREMIUM ROUTE
========================================================= */

const Route=React.memo(({points,prefix})=>{
 if(!points||points.length<2)return null;

 let all=[];
 let cur=[points[0]];

 for(let i=1;i<points.length;i++){

  if(points[i].breakBefore){
   if(cur.length>1)all.push(cur);
   cur=[points[i]];
  }else{
   cur.push(points[i]);
  }
 }

 if(cur.length>1)all.push(cur);

 return(
  <>
   {all.map((s,j)=>{

    let chunks=[];
    let c=[s[0]];
    let col=speedColor(s[0].speedKmh);

    for(let i=0;i<s.length-1;i++){

     let nc=speedColor(
      ((s[i].speedKmh||0)+(s[i+1].speedKmh||0))/2
     );

     if(nc!==col){
      chunks.push({c:col,p:c});
      c=[s[i],s[i+1]];
      col=nc;
     }else{
      c.push(s[i+1]);
     }
    }

    if(c.length>1)
     chunks.push({c:col,p:c});

    return(
     <React.Fragment key={`${prefix}-${j}`}>

      <Polyline
       coordinates={s.map(coord)}
       strokeColor="rgba(0,0,0,.6)"
       strokeWidth={11}
      />

      {chunks.map((x,k)=>(
       <Polyline
        key={k}
        coordinates={x.p.map(coord)}
        strokeColor={x.c}
        strokeWidth={7}
        lineCap="round"
        lineJoin="round"
       />
      ))}

     </React.Fragment>
    );
   })}
  </>
 );
});

const Live=({p})=>
 valid(p)?
 <Marker coordinate={coord(p)}>
  <View style={S.live}>
   <View style={S.liveIn}/>
  </View>
 </Marker>:null;

const Start=({p})=>
 valid(p)?
 <Marker coordinate={coord(p)}>
  <View style={S.start}>
   <View style={S.startIn}/>
  </View>
 </Marker>:null;

const Finish=({p})=>
 valid(p)?
 <Marker coordinate={coord(p)}>
  <View style={S.finish}>
   <View style={S.finishIn}/>
  </View>
 </Marker>:null;


/* =========================================================
   BACKGROUND LOCATION
========================================================= */

TaskManager.defineTask(
 TASK,
 async({data,error})=>{
  if(error||!data?.locations?.length)return;

  try{

   let raw=await AsyncStorage.getItem(SESSION);

   if(!raw)return;

   let s=JSON.parse(raw);

   if(!s?.running||s.paused)return;

   for(const item of data.locations){

    let c=item?.coords;

    if(
     !c||
     !Number.isFinite(c.latitude)||
     !Number.isFinite(c.longitude)||
     c.accuracy>MAX_ACCURACY
    )continue;

    let p={
     latitude:c.latitude,
     longitude:c.longitude,
     accuracy:c.accuracy,
     altitude:c.altitude||0,
     heading:c.heading??-1,
     timestamp:Number(item.timestamp)||Date.now()
    };

    let prev=s.lastPoint||s.route?.[s.route.length-1];

    if(!prev){
     s.lastPoint=p;
     s.route=[
      ...(s.route||[]),
      {...p,speedKmh:0}
     ];
     continue;
    }

    let d=meters(prev,p);

    let dt=Math.max(
     .5,
     (p.timestamp-(prev.timestamp||p.timestamp))/1000
    );

    let v=d/dt*3.6;

    if(d<MIN_MOVE||v>MAX_SPEED)continue;

    let sm=
     (Number(s.speedKmh)||0)*.85+
     v*.15;

    let np={
     ...p,
     speedKmh:Number(sm.toFixed(2))
    };

    if(s.breakPending){
     np.breakBefore=true;
     s.breakPending=false;
    }

    s.route=compact([
     ...(s.route||[]),
     np
    ]);

    s.lastPoint=p;

    s.speedKmh=Number(sm.toFixed(2));

    s.topSpeedKmh=Math.max(
     Number(s.topSpeedKmh)||0,
     v
    );

    s.distanceMeters=
     (Number(s.distanceMeters)||0)+d;
   }

   await AsyncStorage.setItem(
    SESSION,
    JSON.stringify(s)
   );

  }catch(e){
   console.warn("Background tracker error",e);
  }
 }
);


/* =========================================================
   SMALL COMPONENTS
========================================================= */

function Stat({icon,label,value,unit}){
 return(
  <View style={S.stat}>

   <Ionicons
    name={icon}
    size={17}
    color="#B8FF2C"
   />

   <Text style={S.statLabel}>
    {label}
   </Text>

   <View style={S.statRow}>

    <Text
     style={S.statValue}
     numberOfLines={1}
     adjustsFontSizeToFit
    >
     {value}
    </Text>

    <Text style={S.statUnit}>
     {unit}
    </Text>

   </View>

  </View>
 );
}

function HistoryStat({label,value}){
 return(
  <View style={S.hStat}>
   <Text style={S.hLabel}>
    {label}
   </Text>

   <Text style={S.hValue}>
    {value}
   </Text>
  </View>
 );
}

function SummaryBox({icon,label,value}){
 return(
  <View style={S.sumBox}>

   <Ionicons
    name={icon}
    size={18}
    color="#B8FF2C"
   />

   <Text style={S.sumLabel}>
    {label}
   </Text>

   <Text style={S.sumValue}>
    {value}
   </Text>

  </View>
 );
}


/* =========================================================
   APP
========================================================= */

export default function App(){

 const mapRef=useRef(null);
 const doneMap=useRef(null);
 const anim=useRef(new Animated.Value(0)).current;

 const[location,setLocation]=useState(null);
 const[accuracy,setAccuracy]=useState(null);
 const[connected,setConnected]=useState(true);
 const[permission,setPermission]=useState(false);

 const[running,setRunning]=useState(false);
 const[paused,setPaused]=useState(false);

 const[elapsed,setElapsed]=useState(0);

 const[timeData,setTimeData]=useState({
  accumulatedMs:0,
  lastResumeTime:0
 });

 const[distance,setDistance]=useState(0);
 const[speed,setSpeed]=useState(0);
 const[topSpeed,setTopSpeed]=useState(0);
 const[route,setRoute]=useState([]);

 const[target,setTarget]=useState(null);
 const[completed,setCompleted]=useState(false);

 const[mission,setMission]=useState(false);
 const[history,setHistory]=useState([]);
 const[summary,setSummary]=useState(null);
 const[summaryOpen,setSummaryOpen]=useState(false);
 const[historyOpen,setHistoryOpen]=useState(false);

 const[mapType,setMapType]=useState("standard");
 const[follow,setFollow]=useState(true);

 const[mapReady,setMapReady]=useState(false);
 const[mapLayout,setMapLayout]=useState(false);


 /* INIT */

 useEffect(()=>{

  (async()=>{

   try{

    let h=await AsyncStorage.getItem(HISTORY);

    if(h)
     setHistory(JSON.parse(h));

    await setup();

   }catch(e){
    console.warn("Init error",e);
   }

  })();

  let u=NetInfo.addEventListener(
   x=>setConnected(Boolean(x.isConnected))
  );

  return()=>u();

 },[]);


 /* RUNNER ANIMATION */

 useEffect(()=>{

  if(running&&!paused){

   let l=Animated.loop(
    Animated.sequence([
     Animated.timing(anim,{
      toValue:1,
      duration:350,
      useNativeDriver:true
     }),
     Animated.timing(anim,{
      toValue:0,
      duration:350,
      useNativeDriver:true
     })
    ])
   );

   l.start();

   return()=>l.stop();
  }

  anim.stopAnimation();
  anim.setValue(0);

 },[running,paused]);


 /* TIMER */

 useEffect(()=>{

  if(!running)return;

  let id=setInterval(()=>{

   if(
    paused||
    !timeData.lastResumeTime
   ){

    setElapsed(
     Math.floor(
      timeData.accumulatedMs/1000
     )
    );

   }else{

    setElapsed(
     Math.floor(
      (
       timeData.accumulatedMs+
       Date.now()-
       timeData.lastResumeTime
      )/1000
     )
    );
   }

  },1000);

  return()=>clearInterval(id);

 },[running,paused,timeData]);


 /* READ BACKGROUND SESSION */

 useEffect(()=>{

  if(!running)return;

  let id=setInterval(async()=>{

   try{

    let raw=
     await AsyncStorage.getItem(SESSION);

    if(!raw)return;

    let s=JSON.parse(raw);

    setDistance(
     (s.distanceMeters||0)/1000
    );

    setSpeed(
     s.speedKmh||0
    );

    setTopSpeed(
     s.topSpeedKmh||0
    );

    if(Array.isArray(s.route))
     setRoute(s.route);

    if(
     valid(s.lastPoint)
    ){

     setLocation(s.lastPoint);

     setAccuracy(
      s.lastPoint.accuracy
     );

     if(
      follow&&
      mapRef.current&&
      connected
     ){

      mapRef.current.animateToRegion(
       {
        ...coord(s.lastPoint),
        latitudeDelta:DELTA,
        longitudeDelta:DELTA
       },
       450
      );
     }
    }

   }catch(e){
    console.warn("Session read error",e);
   }

  },1000);

  return()=>clearInterval(id);

 },[running,follow,connected]);


 /* MISSION COMPLETE */

 useEffect(()=>{

  if(
   running&&
   target&&
   !completed&&
   distance>=target
  ){

   setCompleted(true);

   Speech.speak(
    "Mission completed",
    {language:"en-IN"}
   );

   Alert.alert(
    "🎉 Mission Completed!",
    `You completed your ${target} KM mission.`
   );

   AsyncStorage
    .getItem(SESSION)
    .then(r=>{

     if(r){

      let s=JSON.parse(r);

      s.challengeCompleted=true;

      AsyncStorage.setItem(
       SESSION,
       JSON.stringify(s)
      );
     }

    });
  }

 },[
  distance,
  running,
  target,
  completed
 ]);


 /* SUMMARY MAP */

 useEffect(()=>{

  if(
   summaryOpen&&
   mapReady&&
   mapLayout&&
   summary?.route?.length>1&&
   doneMap.current&&
   connected
  ){

   doneMap.current.fitToCoordinates(
    summary.route.map(coord),
    {
     edgePadding:{
      top:70,
      right:30,
      bottom:150,
      left:30
     },
     animated:true
    }
   );
  }

 },[
  summaryOpen,
  mapReady,
  mapLayout,
  summary,
  connected
 ]);


 /* LOCATION SETUP */

 async function setup(){

  try{

   let p=
    await Location.requestForegroundPermissionsAsync();

   if(p.status!=="granted"){

    Alert.alert(
     "Location Required",
     "Location permission is required for Raftaar."
    );

    return;
   }

   setPermission(true);

   let cur=
    await Location.getCurrentPositionAsync({
     accuracy:Location.Accuracy.High
    });

   if(cur?.coords){

    setLocation({
     ...cur.coords
    });

    setAccuracy(
     cur.coords.accuracy
    );
   }

   let raw=
    await AsyncStorage.getItem(SESSION);

   if(raw){

    let s=JSON.parse(raw);

    if(s?.running){

     setRunning(true);
     setPaused(Boolean(s.paused));

     setElapsed(
      Math.floor(
       (s.timeData?.accumulatedMs||0)/1000
      )
     );

     setTimeData(
      s.timeData||{
       accumulatedMs:0,
       lastResumeTime:0
      }
     );

     setDistance(
      (s.distanceMeters||0)/1000
     );

     setSpeed(
      s.speedKmh||0
     );

     setTopSpeed(
      s.topSpeedKmh||0
     );

     setRoute(
      s.route||[]
     );

     setTarget(
      s.targetDistance||null
     );

     setCompleted(
      Boolean(s.challengeCompleted)
     );
    }
   }

  }catch(e){
   console.warn("Location setup error",e);
  }
 }


 /* BACKGROUND SERVICE */

 async function startService(){

  try{

   if(
    !(await Location.hasServicesEnabledAsync())
   ){

    Alert.alert(
     "Location Services Off",
     "Please turn on Location Services."
    );

    return false;
   }

   let p=
    await Location.requestBackgroundPermissionsAsync();

   if(p.status!=="granted"){

    Alert.alert(
     "Background Location Required",
     "Allow background location so Raftaar can continue tracking when the screen is locked."
    );

    return false;
   }

   if(
    !(await Location.hasStartedLocationUpdatesAsync(TASK))
   ){

    await Location.startLocationUpdatesAsync(
     TASK,
     {
      accuracy:
       Location.Accuracy.BestForNavigation,

      timeInterval:1000,
      distanceInterval:2,

      showsBackgroundLocationIndicator:true,

      foregroundService:{
       notificationTitle:"Raftaar",
       notificationBody:
        "Your run is being tracked."
      }
     }
    );
   }

   return true;

  }catch(e){

   console.warn(
    "Start service error",
    e
   );

   return false;
  }
 }


 /* START RUN */

 async function startRun(km){

  setMission(false);

  if(!permission)
   await setup();

  if(!(await startService()))
   return;

  try{

   let c=
    await Location.getCurrentPositionAsync({
     accuracy:
      Location.Accuracy.BestForNavigation
    });

   let now=Date.now();

   let p={
    latitude:c.coords.latitude,
    longitude:c.coords.longitude,
    accuracy:c.coords.accuracy,
    altitude:c.coords.altitude||0,
    heading:c.coords.heading??-1,
    timestamp:now,
    speedKmh:0
   };

   let td={
    accumulatedMs:0,
    lastResumeTime:now
   };

   let s={
    running:true,
    paused:false,
    timeData:td,
    distanceMeters:0,
    speedKmh:0,
    topSpeedKmh:0,
    route:[p],
    lastPoint:p,
    breakPending:false,
    targetDistance:km,
    challengeCompleted:false
   };

   await AsyncStorage.setItem(
    SESSION,
    JSON.stringify(s)
   );

   setLocation(p);
   setAccuracy(p.accuracy);
   setTimeData(td);
   setElapsed(0);
   setDistance(0);
   setSpeed(0);
   setTopSpeed(0);
   setRoute([p]);
   setTarget(km);
   setCompleted(false);
   setRunning(true);
   setPaused(false);

   Speech.speak(
    km
     ?`Mission ${km} kilometers started`
     :"Free run started",
    {language:"en-IN"}
   );

   Vibration.vibrate(80);

  }catch(e){

   Alert.alert(
    "Error",
    "Could not start tracking."
   );
  }
 }


 /* PAUSE */

 async function pauseRun(){

  let td={
   accumulatedMs:
    timeData.accumulatedMs+
    Math.max(
     0,
     Date.now()-
     (timeData.lastResumeTime||Date.now())
    ),

   lastResumeTime:null
  };

  setPaused(true);
  setSpeed(0);
  setTimeData(td);

  await AsyncStorage.mergeItem(
   SESSION,
   JSON.stringify({
    paused:true,
    speedKmh:0,
    breakPending:true,
    timeData:td
   })
  );

  Speech.speak(
   "Run paused",
   {language:"en-IN"}
  );

  Vibration.vibrate(70);
 }


 /* RESUME */

 async function resumeRun(){

  try{

   let c=
    await Location.getCurrentPositionAsync({
     accuracy:
      Location.Accuracy.BestForNavigation
    });

   let now=Date.now();

   let td={
    accumulatedMs:
     timeData.accumulatedMs,
    lastResumeTime:now
   };

   let p={
    latitude:c.coords.latitude,
    longitude:c.coords.longitude,
    accuracy:c.coords.accuracy,
    altitude:c.coords.altitude||0,
    heading:c.coords.heading??-1,
    timestamp:now,
    speedKmh:0,
    breakBefore:true
   };

   let raw=
    await AsyncStorage.getItem(SESSION);

   if(raw){

    let s=JSON.parse(raw);

    s.paused=false;
    s.speedKmh=0;
    s.timeData=td;
    s.breakPending=false;
    s.route=[
     ...(s.route||[]),
     p
    ];
    s.lastPoint=p;

    await AsyncStorage.setItem(
     SESSION,
     JSON.stringify(s)
    );
   }

   setRoute(x=>[...x,p]);
   setLocation(p);
   setAccuracy(p.accuracy);
   setTimeData(td);
   setPaused(false);
   setSpeed(0);

   Speech.speak(
    "Run resumed",
    {language:"en-IN"}
   );

   Vibration.vibrate(70);

  }catch(e){
   console.warn("Resume error",e);
  }
 }


 /* FINISH CONFIRM */

 function finishRun(){

  Alert.alert(
   "Finish Run?",
   "Are you sure you want to finish this run?",
   [
    {
     text:"Cancel",
     style:"cancel"
    },
    {
     text:"Finish",
     style:"destructive",
     onPress:completeRun
    }
   ]
  );
 }


 /* SAVE RUN */

 async function completeRun(){

  try{

   let avg=
    elapsed
     ?distance/(elapsed/3600)
     :0;

   let work={
    id:String(Date.now()),
    date:new Date().toISOString(),
    distanceKm:
     Number(distance.toFixed(3)),
    durationSeconds:elapsed,
    averageSpeedKmh:
     Number(avg.toFixed(2)),
    topSpeedKmh:
     Number(topSpeed.toFixed(2)),
    pace:
     pace(distance,elapsed),
    calories:
     calories(distance),
    route:
     compact(route),
    targetDistance:target
   };

   let h=[
    work,
    ...history
   ].slice(0,50);

   await AsyncStorage.setItem(
    HISTORY,
    JSON.stringify(h)
   );

   await AsyncStorage.removeItem(
    SESSION
   );

   if(
    await Location.hasStartedLocationUpdatesAsync(TASK)
   ){

    await Location.stopLocationUpdatesAsync(
     TASK
    );
   }

   setHistory(h);
   setSummary(work);
   setSummaryOpen(true);
   setMapReady(false);
   setMapLayout(false);

   setRunning(false);
   setPaused(false);
   setSpeed(0);
   setTarget(null);
   setCompleted(false);

   Speech.speak(
    "Run completed",
    {language:"en-IN"}
   );

   Vibration.vibrate([
    0,120,80,120
   ]);

  }catch(e){

   console.warn(
    "Complete error",
    e
   );
  }
 }


 const g=gps(accuracy);

 const translateY=
  anim.interpolate({
   inputRange:[0,1],
   outputRange:[0,-10]
  });


 return(
  <SafeAreaView style={S.safe}>

   <StatusBar
    barStyle="light-content"
    backgroundColor="#050505"
   />

   <View style={S.container}>

    {/* HEADER */}

    <View style={S.header}>

     <View>

      <Text style={S.logo}>
       Raftaar
       <Text style={S.dot}>.</Text>
      </Text>

      <View style={S.gpsRow}>

       <View
        style={[
         S.gpsDot,
         {backgroundColor:g.c}
        ]}
       />

       <Text style={S.gpsText}>
        GPS {g.t}
       </Text>

       {Number.isFinite(Number(accuracy))&&(
        <Text style={S.accuracy}>
         ±{Math.round(accuracy)}m
        </Text>
       )}

      </View>

     </View>

     <TouchableOpacity
      style={S.headerBtn}
      onPress={()=>setHistoryOpen(true)}
     >
      <Ionicons
       name="time-outline"
       size={22}
       color="#fff"
      />
     </TouchableOpacity>

    </View>


    {/* HERO */}

    <View style={S.hero}>

     {connected?

      <>

       <MapView
        ref={mapRef}
        style={S.map}
        mapType={mapType}
        customMapStyle={
         mapType==="standard"
          ?mapStyle
          :undefined
        }
        showsCompass={false}
        showsBuildings={false}
        showsTraffic={false}
        showsUserLocation={false}
        initialRegion={
         location
          ?{
            ...coord(location),
            latitudeDelta:DELTA,
            longitudeDelta:DELTA
           }
          :{
            latitude:28.6139,
            longitude:77.209,
            latitudeDelta:.08,
            longitudeDelta:.08
           }
        }
       >

        <Route
         points={route}
         prefix="live"
        />

        {route.length>0&&
         <Start p={route[0]}/>
        }

        {running&&location&&
         <Live p={location}/>
        }

       </MapView>


       {/* LIVE STATUS */}

       <View style={S.livePill}>

        <View style={S.pulse}/>

        <Text style={S.pillText}>
         {running
          ?paused
           ?"PAUSED"
           :"LIVE TRACKING"
          :"READY"}
        </Text>

       </View>


       {/* MAP CONTROLS */}

       <View style={S.mapBtns}>

        <TouchableOpacity
         style={S.mapBtn}
         onPress={()=>setFollow(x=>!x)}
        >

         <Ionicons
          name={
           follow
            ?"locate"
            :"locate-outline"
          }
          size={19}
          color={
           follow
            ?"#B8FF2C"
            :"#fff"
          }
         />

        </TouchableOpacity>

        <TouchableOpacity
         style={S.mapBtn}
         onPress={()=>
          setMapType(x=>
           x==="standard"
            ?"satellite"
            :"standard"
          )
         }
        >

         <Ionicons
          name="layers-outline"
          size={19}
          color="#fff"
         />

        </TouchableOpacity>

       </View>


       {/* SPEED SPECTRUM */}

       <View style={S.legend}>

        <Text style={S.legendTitle}>
         SPEED SPECTRUM
        </Text>

        <View style={S.legendBar}>

         {STOPS.map(x=>
          <View
           key={x.s}
           style={[
            S.legendColor,
            {backgroundColor:x.c}
           ]}
          />
         )}

        </View>

        <View style={S.legendLabels}>
         <Text style={S.legendText}>
          SLOW
         </Text>

         <Text style={S.legendText}>
          FAST
         </Text>
        </View>

       </View>

      </>

      :

      /* OFFLINE */

      <View style={S.offline}>

       <View style={S.runnerOrb}>

        {running&&!paused?

         <Animated.View
          style={{
           transform:[
            {translateY}
           ]
          }}
         >
          <FontAwesome5
           name="running"
           size={38}
           color="#B8FF2C"
          />
         </Animated.View>

         :

         <Ionicons
          name="cloud-offline-outline"
          size={36}
          color="#B8FF2C"
         />

        }

       </View>


       <Text style={S.offlineTitle}>
        {running&&!paused
         ?"TRACKING OFFLINE"
         :"OFFLINE MODE"}
       </Text>


       <Text style={S.metricLabel}>
        {target
         ?"DISTANCE REMAINING"
         :"ELAPSED TIME"}
       </Text>


       {/* IMPORTANT: NO CLIPPING */}

       <View style={S.metricRow}>

        <Text
         style={S.metricBig}
         numberOfLines={1}
         adjustsFontSizeToFit
         minimumFontScale={.7}
        >
         {target
          ?Math.max(
            0,
            target-distance
           ).toFixed(2)
          :timeFmt(elapsed)}
        </Text>

        {target&&
         <Text style={S.metricKm}>
          KM
         </Text>
        }

       </View>


       <Text style={S.metricSub}>
        {target
         ?`OF ${Number(target).toFixed(2)} KM TARGET`
         :"HR : MIN : SEC"}
       </Text>


       {/* ALTITUDE + DIRECTION */}

       <View style={S.offlineStats}>

        <View style={S.offlineStat}>

         <View style={S.iconOrb}>
          <Ionicons
           name="triangle-outline"
           size={16}
           color="#B8FF2C"
          />
         </View>

         <Text style={S.oLabel}>
          ALTITUDE
         </Text>

         <Text style={S.oValue}>
          {location?.altitude
           ?Math.round(location.altitude)
           :"--"}

          <Text style={S.oUnit}>
           {" "}m
          </Text>
         </Text>

        </View>


        <View style={S.offlineStat}>

         <View style={S.iconOrb}>
          <Ionicons
           name="compass-outline"
           size={18}
           color="#B8FF2C"
          />
         </View>

         <Text style={S.oLabel}>
          DIRECTION
         </Text>

         <Text style={S.oValue}>
          {direction(location?.heading)}

          <Text style={S.oUnit}>
           {location?.heading>=0
            ?`  ${Math.round(location.heading)}°`
            :""}
          </Text>
         </Text>

        </View>

       </View>

      </View>
     }

    </View>


    {/* DASHBOARD */}

    <View style={S.panel}>

     <View style={S.distanceBlock}>

      <Text style={S.distanceLabel}>
       DISTANCE
      </Text>

      <View style={S.distanceRow}>

       <Text style={S.distance}>
        {distance.toFixed(2)}
       </Text>

       <Text style={S.distanceUnit}>
        KM
       </Text>

      </View>


      <View style={S.timer}>

       <Ionicons
        name="time-outline"
        size={14}
        color="#777"
       />

       <Text style={S.timerText}>
        {timeFmt(elapsed)}
       </Text>

      </View>

     </View>


     {/* FOUR METRICS */}

     <View style={S.stats}>

      <Stat
       icon="speedometer-outline"
       label="SPEED"
       value={speed.toFixed(1)}
       unit="KM/H"
      />

      <Stat
       icon="trending-up-outline"
       label="TOP SPEED"
       value={topSpeed.toFixed(1)}
       unit="KM/H"
      />

      <Stat
       icon="walk-outline"
       label="PACE"
       value={pace(distance,elapsed)}
       unit="/KM"
      />

      <Stat
       icon="flame-outline"
       label="CALORIES"
       value={calories(distance)}
       unit="KCAL"
      />

     </View>


     {/* ACTION */}

     {!running?

      <TouchableOpacity
       style={S.startBtn}
       onPress={()=>setMission(true)}
       activeOpacity={.85}
      >

       <View style={S.playOrb}>
        <Ionicons
         name="play"
         size={15}
         color="#050505"
        />
       </View>

       <Text style={S.startText}>
        START MISSION
       </Text>

       <Ionicons
        name="arrow-forward"
        size={18}
        color="#050505"
       />

      </TouchableOpacity>

      :

      <View style={S.actions}>

       <TouchableOpacity
        style={S.pauseBtn}
        onPress={
         paused
          ?resumeRun
          :pauseRun
        }
       >

        <Ionicons
         name={
          paused
           ?"play"
           :"pause"
         }
         size={18}
         color="#fff"
        />

        <Text style={S.actionText}>
         {paused
          ?"RESUME"
          :"PAUSE"}
        </Text>

       </TouchableOpacity>


       <TouchableOpacity
        style={S.finishBtn}
        onPress={finishRun}
       >

        <Ionicons
         name="stop"
         size={18}
         color="#fff"
        />

        <Text style={S.actionText}>
         FINISH
        </Text>

       </TouchableOpacity>

      </View>

     }

    </View>


    {/* =====================================================
        MISSION MODAL
    ===================================================== */}

    <Modal
     visible={mission}
     transparent
     animationType="slide"
     onRequestClose={()=>setMission(false)}
    >

     <View style={S.overlay}>

      <View style={S.sheet}>

       <View style={S.sheetHead}>

        <View>

         <Text style={S.sheetTitle}>
          SELECT MISSION
         </Text>

         <Text style={S.sheetSub}>
          Choose your target for this run.
         </Text>

        </View>

        <TouchableOpacity
         onPress={()=>setMission(false)}
        >
         <Ionicons
          name="close-circle"
          size={28}
          color="#666"
         />
        </TouchableOpacity>

       </View>


       {[
        [
         null,
         "Free Run",
         "infinite-outline",
         "#B8FF2C"
        ],
        [
         1,
         "1 KM Sprint",
         "medal-outline",
         "#FACC15"
        ],
        [
         3,
         "3 KM Challenge",
         "flame-outline",
         "#FB923C"
        ],
        [
         5,
         "5 KM Pro Mission",
         "trophy-outline",
         "#A78BFA"
        ],
        [
         10,
         "10 KM Endurance",
         "star-outline",
         "#22C55E"
        ]
       ].map(([k,t,ic,c])=>

        <TouchableOpacity
         key={String(k)}
         style={S.option}
         onPress={()=>startRun(k)}
        >

         <View
          style={[
           S.optionIcon,
           {
            backgroundColor:
             c+"15"
           }
          ]}
         >

          <Ionicons
           name={ic}
           size={20}
           color={c}
          />

         </View>

         <Text style={S.optionText}>
          {t}
         </Text>

         <Ionicons
          name="chevron-forward"
          size={18}
          color="#555"
         />

        </TouchableOpacity>

       )}

      </View>

     </View>

    </Modal>


    {/* =====================================================
        SUMMARY
    ===================================================== */}

    <Modal
     visible={summaryOpen}
     animationType="slide"
     onRequestClose={()=>
      setSummaryOpen(false)
     }
    >

     <SafeAreaView style={S.modal}>

      <View style={S.modalHead}>

       <View>

        <Text style={S.modalTitle}>
         RUN COMPLETE
        </Text>

        <Text style={S.modalSub}>
         Your performance, beautifully summarized.
        </Text>

       </View>

       <TouchableOpacity
        style={S.close}
        onPress={()=>
         setSummaryOpen(false)
        }
       >

        <Ionicons
         name="close"
         size={20}
         color="#fff"
        />

       </TouchableOpacity>

      </View>


      {summary&&

       <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={S.scroll}
       >

        {summary.targetDistance&&
         summary.distanceKm>=summary.targetDistance&&

         <View style={S.achievement}>

          <Ionicons
           name="trophy"
           size={20}
           color="#B8FF2C"
          />

          <Text style={S.achievementText}>
           MISSION ACCOMPLISHED
          </Text>

         </View>
        }


        <View
         style={S.sumMap}
         onLayout={()=>
          setMapLayout(true)
         }
        >

         {connected?

          <MapView
           ref={doneMap}
           style={S.map}
           customMapStyle={mapStyle}
           showsCompass={false}
           showsBuildings={false}
           showsTraffic={false}
           onMapReady={()=>
            setMapReady(true)
           }
          >

           <Route
            points={summary.route||[]}
            prefix="sum"
           />

           {summary.route?.length>0&&
            <>
             <Start
              p={summary.route[0]}
             />

             <Finish
              p={summary.route[
               summary.route.length-1
              ]}
             />
            </>
           }

          </MapView>

          :

          <View style={S.offline}>

           <Ionicons
            name="map-outline"
            size={34}
            color="#555"
           />

           <Text style={S.offlineTitle}>
            MAP UNAVAILABLE
           </Text>

          </View>
         }


         <View style={S.sumMapTag}>
          <Text style={S.sumMapTagText}>
           SPEED SPECTRUM
          </Text>
         </View>

        </View>


        <View style={S.bigSum}>

         <Text style={S.distanceLabel}>
          DISTANCE
         </Text>

         <Text style={S.bigSumValue}>
          {Number(
           summary.distanceKm||0
          ).toFixed(2)}

          <Text style={S.bigSumUnit}>
           {" "}KM
          </Text>

         </Text>

         <Text style={S.bigSumTime}>
          {timeFmt(
           summary.durationSeconds
          )}
         </Text>

        </View>


        <View style={S.sumGrid}>

         <SummaryBox
          icon="speedometer-outline"
          label="AVG SPEED"
          value={`${Number(
           summary.averageSpeedKmh||0
          ).toFixed(1)} km/h`}
         />

         <SummaryBox
          icon="trending-up-outline"
          label="TOP SPEED"
          value={`${Number(
           summary.topSpeedKmh||0
          ).toFixed(1)} km/h`}
         />

         <SummaryBox
          icon="walk-outline"
          label="PACE"
          value={`${summary.pace}/km`}
         />

         <SummaryBox
          icon="flame-outline"
          label="CALORIES"
          value={`${summary.calories} kcal`}
         />

        </View>


        <View style={S.spectrum}>

         <Text style={S.sumLabel}>
          SPEED SPECTRUM
         </Text>

         <View style={S.legendBar}>

          {STOPS.map(x=>
           <View
            key={x.s}
            style={[
             S.legendColor,
             {
              backgroundColor:x.c
             }
            ]}
           />
          )}

         </View>

        </View>


        <TouchableOpacity
         style={S.done}
         onPress={()=>
          setSummaryOpen(false)
         }
        >

         <Text style={S.doneText}>
          DONE
         </Text>

        </TouchableOpacity>

       </ScrollView>
      }

     </SafeAreaView>

    </Modal>


    {/* =====================================================
        HISTORY
    ===================================================== */}

    <Modal
     visible={historyOpen}
     animationType="slide"
     onRequestClose={()=>
      setHistoryOpen(false)
     }
    >

     <SafeAreaView style={S.modal}>

      <View style={S.modalHead}>

       <View>

        <Text style={S.modalTitle}>
         RUN HISTORY
        </Text>

        <Text style={S.modalSub}>
         Your previous workouts.
        </Text>

       </View>

       <TouchableOpacity
        style={S.close}
        onPress={()=>
         setHistoryOpen(false)
        }
       >

        <Ionicons
         name="close"
         size={20}
         color="#fff"
        />

       </TouchableOpacity>

      </View>


      <ScrollView
       contentContainerStyle={S.scroll}
      >

       {history.length===0?

        <View style={S.empty}>

         <Ionicons
          name="footsteps-outline"
          size={48}
          color="#555"
         />

         <Text style={S.emptyTitle}>
          No runs yet
         </Text>

         <Text style={S.emptyText}>
          Complete your first run and it will appear here.
         </Text>

        </View>

        :

        history.map((x,i)=>

         <View
          key={x.id||i}
          style={S.hCard}
         >

          <View style={S.hHead}>

           <View>

            <Text style={S.hDate}>
             {new Date(
              x.date
             ).toLocaleDateString(
              "en-IN",
              {
               day:"2-digit",
               month:"short",
               year:"numeric"
              }
             )}
            </Text>

            <Text style={S.hDistance}>
             {Number(
              x.distanceKm||0
             ).toFixed(2)} KM
            </Text>

           </View>

           {x.targetDistance&&
            x.distanceKm>=x.targetDistance&&

            <Ionicons
             name="trophy"
             size={20}
             color="#B8FF2C"
            />
           }

          </View>


          <View style={S.hStats}>

           <HistoryStat
            label="TIME"
            value={timeFmt(
             x.durationSeconds
            )}
           />

           <HistoryStat
            label="PACE"
            value={`${x.pace}/km`}
           />

           <HistoryStat
            label="TOP"
            value={`${Number(
             x.topSpeedKmh||0
            ).toFixed(1)} km/h`}
           />

           <HistoryStat
            label="CAL"
            value={String(
             x.calories
            )}
           />

          </View>

         </View>

        )

       }

      </ScrollView>

     </SafeAreaView>

    </Modal>

   </View>

  </SafeAreaView>
 );
}


/* =========================================================
   PREMIUM RAFTAAR STYLE SYSTEM
========================================================= */

const S=StyleSheet.create({

 safe:{
  flex:1,
  backgroundColor:"#050505"
 },

 container:{
  flex:1,
  backgroundColor:"#050505"
 },


 /* HEADER */

 header:{
  minHeight:76,
  paddingHorizontal:20,
  paddingTop:7,
  paddingBottom:9,
  flexDirection:"row",
  alignItems:"center",
  justifyContent:"space-between"
 },

 logo:{
  color:"#F6F6F6",
  fontSize:25,
  fontWeight:"900",
  letterSpacing:-.9
 },

 dot:{
  color:"#B8FF2C"
 },

 gpsRow:{
  flexDirection:"row",
  alignItems:"center",
  marginTop:7
 },

 gpsDot:{
  width:7,
  height:7,
  borderRadius:4,
  marginRight:7
 },

 gpsText:{
  color:"#9A9A9A",
  fontSize:9,
  fontWeight:"900",
  letterSpacing:1.3
 },

 accuracy:{
  color:"#5E625E",
  fontSize:9,
  fontWeight:"700",
  marginLeft:7
 },

 headerBtn:{
  width:48,
  height:48,
  borderRadius:17,
  backgroundColor:"#0C0D0C",
  alignItems:"center",
  justifyContent:"center",
  borderWidth:1,
  borderColor:"#252925"
 },


 /* HERO MAP */

 hero:{
  flex:1,
  minHeight:300,
  marginHorizontal:18,
  marginBottom:8,
  borderRadius:30,
  overflow:"hidden",
  backgroundColor:"#090A09",
  borderWidth:1,
  borderColor:"#202420"
 },

 map:{
  flex:1
 },

 livePill:{
  position:"absolute",
  left:14,
  top:14,
  flexDirection:"row",
  alignItems:"center",
  paddingHorizontal:11,
  paddingVertical:8,
  borderRadius:20,
  backgroundColor:"rgba(5,5,5,.88)",
  borderWidth:1,
  borderColor:"rgba(255,255,255,.08)"
 },

 pulse:{
  width:6,
  height:6,
  borderRadius:3,
  backgroundColor:"#B8FF2C",
  marginRight:7
 },

 pillText:{
  color:"#EEE",
  fontSize:8,
  fontWeight:"900",
  letterSpacing:1.2
 },

 mapBtns:{
  position:"absolute",
  right:13,
  top:13,
  gap:8
 },

 mapBtn:{
  width:43,
  height:43,
  borderRadius:15,
  backgroundColor:"rgba(5,5,5,.9)",
  alignItems:"center",
  justifyContent:"center",
  borderWidth:1,
  borderColor:"rgba(255,255,255,.08)"
 },

 legend:{
  position:"absolute",
  left:14,
  right:14,
  bottom:14,
  padding:11,
  borderRadius:17,
  backgroundColor:"rgba(5,5,5,.9)",
  borderWidth:1,
  borderColor:"rgba(255,255,255,.07)"
 },

 legendTitle:{
  color:"#BFC3BF",
  fontSize:8,
  fontWeight:"900",
  letterSpacing:1.5,
  marginBottom:7
 },

 legendBar:{
  height:7,
  borderRadius:5,
  overflow:"hidden",
  flexDirection:"row"
 },

 legendColor:{
  flex:1
 },

 legendLabels:{
  marginTop:5,
  flexDirection:"row",
  justifyContent:"space-between"
 },

 legendText:{
  color:"#666",
  fontSize:7,
  fontWeight:"900",
  letterSpacing:.7
 },


 /* MARKERS */

 live:{
  width:29,
  height:29,
  borderRadius:15,
  backgroundColor:"rgba(184,255,44,.18)",
  alignItems:"center",
  justifyContent:"center",
  borderWidth:1,
  borderColor:"rgba(184,255,44,.55)"
 },

 liveIn:{
  width:12,
  height:12,
  borderRadius:6,
  backgroundColor:"#B8FF2C",
  borderWidth:2,
  borderColor:"#050505"
 },

 start:{
  width:24,
  height:24,
  borderRadius:12,
  backgroundColor:"#B8FF2C",
  borderWidth:3,
  borderColor:"#050505",
  alignItems:"center",
  justifyContent:"center"
 },

 startIn:{
  width:5,
  height:5,
  borderRadius:3,
  backgroundColor:"#050505"
 },

 finish:{
  width:26,
  height:26,
  borderRadius:13,
  backgroundColor:"#FFF",
  borderWidth:3,
  borderColor:"#050505",
  alignItems:"center",
  justifyContent:"center"
 },

 finishIn:{
  width:8,
  height:8,
  borderRadius:2,
  backgroundColor:"#050505"
 },


 /* OFFLINE */

 offline:{
  flex:1,
  backgroundColor:"#090A09",
  alignItems:"center",
  justifyContent:"center",
  paddingHorizontal:20,
  paddingVertical:18
 },

 runnerOrb:{
  width:68,
  height:68,
  borderRadius:34,
  backgroundColor:"rgba(184,255,44,.07)",
  alignItems:"center",
  justifyContent:"center",
  borderWidth:1,
  borderColor:"rgba(184,255,44,.18)",
  marginBottom:11
 },

 offlineTitle:{
  color:"#777",
  fontSize:9,
  fontWeight:"900",
  letterSpacing:2.1,
  marginBottom:18
 },

 metricLabel:{
  color:"#666",
  fontSize:8,
  fontWeight:"900",
  letterSpacing:1.7,
  marginBottom:3
 },

 metricRow:{
  width:"100%",
  minHeight:76,
  flexDirection:"row",
  alignItems:"center",
  justifyContent:"center",
  paddingHorizontal:3
 },

 metricBig:{
  color:"#F7F7F7",
  fontSize:68,
  lineHeight:76,
  fontWeight:"900",
  letterSpacing:-2,
  fontVariant:["tabular-nums"],
  includeFontPadding:false,
  textAlign:"center",
  flexShrink:1
 },

 metricKm:{
  color:"#B8FF2C",
  fontSize:13,
  fontWeight:"900",
  marginLeft:6,
  marginTop:28
 },

 metricSub:{
  color:"#B8FF2C",
  fontSize:9,
  fontWeight:"900",
  letterSpacing:1,
  marginTop:2,
  textAlign:"center"
 },

 offlineStats:{
  flexDirection:"row",
  gap:9,
  marginTop:17,
  width:"100%"
 },

 offlineStat:{
  flex:1,
  minHeight:78,
  backgroundColor:"#0E100E",
  borderRadius:18,
  borderWidth:1,
  borderColor:"#222622",
  paddingVertical:9,
  alignItems:"center",
  justifyContent:"center"
 },

 iconOrb:{
  width:29,
  height:29,
  borderRadius:15,
  backgroundColor:"rgba(184,255,44,.07)",
  alignItems:"center",
  justifyContent:"center",
  marginBottom:3
 },

 oLabel:{
  color:"#626862",
  fontSize:7,
  fontWeight:"900",
  letterSpacing:1,
  marginBottom:2
 },

 oValue:{
  color:"#F5F5F5",
  fontSize:16,
  fontWeight:"900"
 },

 oUnit:{
  color:"#686868",
  fontSize:9,
  fontWeight:"800"
 },


 /* DASHBOARD */

 panel:{
  backgroundColor:"#050505",
  paddingHorizontal:18,
  paddingTop:5,

  /*
   IMPORTANT:
   Android navigation bar / gesture area
   ke upar extra space.
  */
  paddingBottom:
   Platform.OS==="ios"
    ?20
    :52
 },

 distanceBlock:{
  alignItems:"center"
 },

 distanceLabel:{
  color:"#6D716D",
  fontSize:8,
  fontWeight:"900",
  letterSpacing:2.1
 },

 distanceRow:{
  flexDirection:"row",
  alignItems:"baseline",
  justifyContent:"center"
 },

 distance:{
  color:"#F7F7F7",
  fontSize:46,
  lineHeight:54,
  fontWeight:"900",
  letterSpacing:-1.8,
  fontVariant:["tabular-nums"],
  includeFontPadding:false
 },

 distanceUnit:{
  color:"#777",
  fontSize:12,
  fontWeight:"900",
  marginLeft:4
 },

 timer:{
  flexDirection:"row",
  alignItems:"center",
  paddingHorizontal:11,
  paddingVertical:6,
  borderRadius:20,
  backgroundColor:"#0D0F0D",
  marginTop:3,
  borderWidth:1,
  borderColor:"#222622"
 },

 timerText:{
  color:"#858985",
  fontSize:10,
  fontWeight:"800",
  marginLeft:5,
  fontVariant:["tabular-nums"]
 },

 stats:{
  flexDirection:"row",
  gap:7,
  marginTop:11
 },

 stat:{
  flex:1,
  minHeight:68,
  padding:9,
  borderRadius:17,
  backgroundColor:"#0C0E0C",
  borderWidth:1,
  borderColor:"#222622"
 },

 statLabel:{
  color:"#646864",
  fontSize:7,
  fontWeight:"900",
  letterSpacing:.8,
  marginTop:5
 },

 statRow:{
  flexDirection:"row",
  alignItems:"baseline",
  marginTop:2
 },

 statValue:{
  color:"#F5F5F5",
  fontSize:15,
  fontWeight:"900",
  fontVariant:["tabular-nums"],
  flexShrink:1
 },

 statUnit:{
  color:"#626662",
  fontSize:6.5,
  fontWeight:"800",
  marginLeft:2
 },


 /* CTA */

 startBtn:{
  height:56,
  borderRadius:19,
  backgroundColor:"#B8FF2C",
  flexDirection:"row",
  alignItems:"center",
  justifyContent:"center",
  marginTop:11,
  gap:9,
  shadowColor:"#B8FF2C",
  shadowOpacity:.16,
  shadowRadius:15,
  shadowOffset:{
   width:0,
   height:6
  },
  elevation:4
 },

 playOrb:{
  width:28,
  height:28,
  borderRadius:14,
  backgroundColor:"rgba(0,0,0,.1)",
  alignItems:"center",
  justifyContent:"center"
 },

 startText:{
  color:"#050505",
  fontSize:12,
  fontWeight:"900",
  letterSpacing:1.2
 },

 actions:{
  flexDirection:"row",
  gap:9,
  marginTop:11
 },

 pauseBtn:{
  flex:1,
  height:55,
  borderRadius:18,
  backgroundColor:"#111311",
  borderWidth:1,
  borderColor:"#303530",
  flexDirection:"row",
  alignItems:"center",
  justifyContent:"center",
  gap:8
 },

 finishBtn:{
  flex:1,
  height:55,
  borderRadius:18,
  backgroundColor:"#1A1110",
  borderWidth:1,
  borderColor:"#6B2924",
  flexDirection:"row",
  alignItems:"center",
  justifyContent:"center",
  gap:8
 },

 actionText:{
  color:"#FFF",
  fontSize:12,
  fontWeight:"900",
  letterSpacing:.8
 },


 /* MISSION */

 overlay:{
  flex:1,
  backgroundColor:"rgba(0,0,0,.78)",
  justifyContent:"flex-end"
 },

 sheet:{
  backgroundColor:"#0D0F0D",
  borderTopLeftRadius:30,
  borderTopRightRadius:30,
  padding:22,
  paddingBottom:
   Platform.OS==="ios"
    ?38
    :30,
  borderWidth:1,
  borderColor:"#252925"
 },

 sheetHead:{
  flexDirection:"row",
  justifyContent:"space-between",
  alignItems:"center",
  marginBottom:17
 },

 sheetTitle:{
  color:"#F5F5F5",
  fontSize:18,
  fontWeight:"900",
  letterSpacing:.4
 },

 sheetSub:{
  color:"#777",
  fontSize:10,
  marginTop:4
 },

 option:{
  height:62,
  flexDirection:"row",
  alignItems:"center",
  backgroundColor:"#111411",
  paddingHorizontal:12,
  borderRadius:17,
  marginBottom:9,
  borderWidth:1,
  borderColor:"#242824"
 },

 optionIcon:{
  width:38,
  height:38,
  borderRadius:13,
  alignItems:"center",
  justifyContent:"center"
 },

 optionText:{
  flex:1,
  color:"#F5F5F5",
  fontSize:13,
  fontWeight:"800",
  marginLeft:12
 },


 /* MODALS */

 modal:{
  flex:1,
  backgroundColor:"#050505"
 },

 modalHead:{
  height:78,
  paddingHorizontal:20,
  flexDirection:"row",
  alignItems:"center",
  justifyContent:"space-between"
 },

 modalTitle:{
  color:"#F5F5F5",
  fontSize:20,
  fontWeight:"900",
  letterSpacing:1.1
 },

 modalSub:{
  color:"#666",
  fontSize:10,
  marginTop:3
 },

 close:{
  width:43,
  height:43,
  borderRadius:15,
  backgroundColor:"#0D0F0D",
  alignItems:"center",
  justifyContent:"center",
  borderWidth:1,
  borderColor:"#242824"
 },

 scroll:{
  paddingHorizontal:16,
  paddingBottom:40
 },

 achievement:{
  flexDirection:"row",
  alignItems:"center",
  justifyContent:"center",
  backgroundColor:"rgba(184,255,44,.09)",
  padding:12,
  borderRadius:16,
  marginBottom:12,
  borderWidth:1,
  borderColor:"rgba(184,255,44,.25)"
 },

 achievementText:{
  color:"#B8FF2C",
  fontSize:11,
  fontWeight:"900",
  letterSpacing:1,
  marginLeft:8
 },

 sumMap:{
  height:height*.39,
  borderRadius:26,
  overflow:"hidden",
  borderWidth:1,
  borderColor:"#242824",
  backgroundColor:"#0D0F0D"
 },

 sumMapTag:{
  position:"absolute",
  top:13,
  left:13,
  paddingHorizontal:10,
  paddingVertical:7,
  borderRadius:10,
  backgroundColor:"rgba(5,5,5,.9)"
 },

 sumMapTagText:{
  color:"#B8FF2C",
  fontSize:8,
  fontWeight:"900",
  letterSpacing:1.1
 },

 bigSum:{
  marginTop:12,
  padding:20,
  borderRadius:22,
  backgroundColor:"#0D0F0D",
  borderWidth:1,
  borderColor:"#242824",
  alignItems:"center"
 },

 bigSumValue:{
  color:"#F5F5F5",
  fontSize:42,
  fontWeight:"900",
  marginTop:2,
  fontVariant:["tabular-nums"]
 },

 bigSumUnit:{
  color:"#777",
  fontSize:13
 },

 bigSumTime:{
  color:"#999",
  fontSize:12,
  fontWeight:"800",
  marginTop:3
 },

 sumGrid:{
  flexDirection:"row",
  flexWrap:"wrap",
  gap:9,
  marginTop:10
 },

 sumBox:{
  width:(width-41)/2,
  minHeight:100,
  borderRadius:19,
  backgroundColor:"#0D0F0D",
  borderWidth:1,
  borderColor:"#242824",
  padding:13
 },

 sumLabel:{
  color:"#6C706C",
  fontSize:8,
  fontWeight:"900",
  letterSpacing:1,
  marginTop:7
 },

 sumValue:{
  color:"#F5F5F5",
  fontSize:16,
  fontWeight:"900",
  marginTop:4
 },

 spectrum:{
  marginTop:10,
  padding:15,
  borderRadius:19,
  backgroundColor:"#0D0F0D",
  borderWidth:1,
  borderColor:"#242824"
 },

 done:{
  height:56,
  borderRadius:18,
  backgroundColor:"#B8FF2C",
  alignItems:"center",
  justifyContent:"center",
  marginTop:12
 },

 doneText:{
  color:"#050505",
  fontSize:13,
  fontWeight:"900",
  letterSpacing:1.2
 },


 /* HISTORY */

 hCard:{
  backgroundColor:"#0D0F0D",
  borderRadius:19,
  borderWidth:1,
  borderColor:"#242824",
  padding:15,
  marginBottom:10
 },

 hHead:{
  flexDirection:"row",
  justifyContent:"space-between",
  alignItems:"center"
 },

 hDate:{
  color:"#6C6C6C",
  fontSize:10,
  fontWeight:"800"
 },

 hDistance:{
  color:"#F5F5F5",
  fontSize:22,
  fontWeight:"900",
  marginTop:2
 },

 hStats:{
  flexDirection:"row",
  marginTop:13,
  paddingTop:12,
  borderTopWidth:1,
  borderTopColor:"#242824"
 },

 hStat:{
  flex:1
 },

 hLabel:{
  color:"#626262",
  fontSize:7,
  fontWeight:"900",
  letterSpacing:.8
 },

 hValue:{
  color:"#EAEAEA",
  fontSize:11,
  fontWeight:"800",
  marginTop:3
 },

 empty:{
  minHeight:height*.65,
  alignItems:"center",
  justifyContent:"center",
  paddingHorizontal:40
 },

 emptyTitle:{
  color:"#F5F5F5",
  fontSize:18,
  fontWeight:"900",
  marginTop:14
 },

 emptyText:{
  color:"#666",
  fontSize:12,
  textAlign:"center",
  lineHeight:18,
  marginTop:6
 }

});
