import ctypes as c,pathlib,json,base64,struct,hashlib,sys,math
U=c.c_uint;P=c.c_void_p;I=c.c_long;B=c.c_int;F=c.c_float
class PP(c.Structure):_fields_=[('width',U),('height',U),('format',U),('count',U),('multi',U),('quality',U),('swap',U),('hwnd',P),('windowed',B),('depth',B),('depthFmt',U),('flags',U),('rate',U),('interval',U)]
class VP(c.Structure):_fields_=[('x',U),('y',U),('w',U),('h',U),('minz',F),('maxz',F)]
class LR(c.Structure):_fields_=[('pitch',I),('bits',P)]
class VE(c.Structure):_fields_=[('stream',c.c_ushort),('offset',c.c_ushort),('type',c.c_ubyte),('method',c.c_ubyte),('usage',c.c_ubyte),('idx',c.c_ubyte)]
class V3(c.Structure):_fields_=[('x',F),('y',F),('z',F)]
class C4(c.Structure):_fields_=[('r',F),('g',F),('b',F),('a',F)]
class LIGHT(c.Structure):_fields_=[('type',U),('diffuse',C4),('specular',C4),('ambient',C4),('position',V3),('direction',V3),('range',F),('falloff',F),('att0',F),('att1',F),('att2',F),('theta',F),('phi',F)]
def m(o,n,ret,args):return c.WINFUNCTYPE(ret,P,*args)(c.cast(o,c.POINTER(c.POINTER(P))).contents[n])
def ck(hr,what):
 if hr<0:raise RuntimeError(what+' '+hex(hr&0xffffffff))
def call(o,n,args,ats,what='call'):hr=m(o,n,I,ats)(o,*args);ck(hr,what);return hr
def release(o):
 if o:m(o,2,U,[])(o)
N=32;d3d=c.WinDLL('d3d9').Direct3DCreate9;d3d.argtypes=[U];d3d.restype=P;api=d3d(32);hw=c.WinDLL('user32').GetDesktopWindow();pp=PP(N,N,0,1,0,0,1,hw,1,0,0,0,0,0x80000000);device=P();call(api,16,[0,1,hw,0x40,c.byref(pp),c.byref(device)],[U,U,P,U,c.POINTER(PP),c.POINTER(P)],'CreateHAL');print('HAL ready',flush=True)
rt=P();readback=P();call(device,28,[N,N,21,0,0,0,c.byref(rt),None],[U,U,U,U,U,B,c.POINTER(P),P],'RT');call(device,36,[N,N,21,2,c.byref(readback),None],[U,U,U,U,c.POINTER(P),P],'Readback');call(device,37,[0,rt],[U,P]);call(device,39,[None],[P]);vp=VP(0,0,N,N,0,1);call(device,47,[c.byref(vp)],[c.POINTER(VP)])
f=c.WinDLL('d3dx9_43').D3DXCreateEffect;f.argtypes=[P,P,U,P,P,U,P,c.POINTER(P),c.POINTER(P)];f.restype=I
def effect(name):
 b=pathlib.Path(str(pathlib.Path(sys.argv[1])/(name+'.FXO'))).read_bytes();buf=c.create_string_buffer(b);eff=P();err=P();ck(f(device,buf,len(b),None,None,0,None,c.byref(eff),c.byref(err)),'Effect '+name);return eff,b
fx,fxb=effect('PLANET');globalfx,gb=effect('GLOBAL-BASE')
def par(eff,name):return m(eff,9,P,[P,c.c_char_p])(eff,None,name.encode())
def setv(eff,name,values):
 h=par(eff,name)
 if not h:raise RuntimeError('Missing '+name)
 a=(F*len(values))(*values);call(eff,20,[h,a,4*len(values)],[P,P,U],'Set '+name)
def tex(pixels):
 t=P();call(device,23,[2,2,1,0,21,1,c.byref(t),None],[U,U,U,U,U,U,c.POINTER(P),P],'texture');lr=LR();call(t,19,[0,c.byref(lr),None,0],[U,c.POINTER(LR),P,U],'lock texture')
 for y in range(2):
  row=bytes(sum(([pixels[(y*2+x)*4+2],pixels[(y*2+x)*4+1],pixels[(y*2+x)*4],pixels[(y*2+x)*4+3]] for x in range(2)),[]));c.memmove(lr.bits+y*lr.pitch,row,8)
 call(t,20,[0],[U]);return t
textures={
 'BaseTexture':[16,32,64,96,240,48,80,160,80,224,96,224,160,144,208,32],
 'NormalTexture':[128,128,255,64,180,120,235,128,96,160,245,192,140,90,250,240],
 'CloudTexture':[200,220,240,32,160,180,200,96,120,150,180,160,240,230,220,224],
 'CloudNormalTexture':[128,128,255,255,150,135,250,255,110,150,245,255,130,100,250,255]}
texobjs={k:tex(v) for k,v in textures.items()}
for k,t in texobjs.items():call(fx,52,[par(fx,k),t],[P,P],'set texture '+k)
ident=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
sun=[.3,-.4,.8660254037844386];sd=[.4,.3,.2];sp=[.8,.6,.4];ambient=[.02,.03,.04];scale=[.8,.9,1,1]
params={'m_world':ident,'m_worldViewProj':ident,'m_worldView':ident,'m_view':ident,'m_projection':ident,'m_worldInv':ident,'m_viewInv':ident,'m_worldViewInv':ident,'m_eyePos':[0,0,5,1],'m_eyePosObj':[0,0,5,1],'m_light0Vector':sun+[0],'m_light0ObjVector':sun,'m_light0Diffuse':sd+[1],'m_light0Specular':sp+[0],'m_lightScale':scale,'m_time':[3],'Diffuse':[.65,.72,.83],'Emissive':[.01,.015,.02],'Specular':[.2,.3,.4],'Atmosphere':[.03,.05,.08,.7],'AtmospherePower':[4.5],'CloudScrollRate':[.0025],'CityColor':[.4,.2,.1],'m_fogVals':[0,1]}
sh=[]
for a in ambient:
 mat=[0]*16;mat[15]=a*3.5449052*.282095;sh+=mat
if '--varied' in sys.argv:
 def norm(v):
  q=math.sqrt(sum(x*x for x in v));return [x/q for x in v]
 def mm(a,b):return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
 def col(a):return [a[i][j] for j in range(4) for i in range(4)]
 def inv(a):
  a=[r.copy()+[int(i==j) for j in range(4)] for i,r in enumerate(a)]
  for j in range(4):
   k=max(range(j,4),key=lambda i:abs(a[i][j]));a[j],a[k]=a[k],a[j];z=a[j][j];a[j]=[x/z for x in a[j]]
   for i in range(4):
    if i!=j:
     z=a[i][j];a[i]=[x-z*y for x,y in zip(a[i],a[j])]
  return [r[4:] for r in a]
 def transform(a,v):return [sum(a[i][j]*v[j] for j in range(4)) for i in range(4)]
 cx,sx=math.cos(-.19),math.sin(-.19);cy,sy=math.cos(.28),math.sin(.28);cz,sz=math.cos(.38),math.sin(.38)
 rx=[[1,0,0,0],[0,cx,-sx,0],[0,sx,cx,0],[0,0,0,1]];ry=[[cy,0,sy,0],[0,1,0,0],[-sy,0,cy,0],[0,0,0,1]];rz=[[cz,-sz,0,0],[sz,cz,0,0],[0,0,1,0],[0,0,0,1]]
 sc=[[.75,0,0,0],[0,1.1,0,0],[0,0,.65,0],[0,0,0,1]];tr=[[1,0,0,0],[0,1,0,0],[0,0,1,.45],[0,0,0,1]]
 world=mm(tr,mm(rz,mm(ry,mm(rx,sc))));iw=inv(world);world_data=col(world)
 params['m_world']=world_data;params['m_worldViewProj']=world_data;params['m_worldView']=world_data;params['m_worldInv']=col(iw);params['m_worldViewInv']=col(iw)
 params['m_eyePosObj']=transform(iw,[0,0,5,1]);params['m_light0ObjVector']=norm(transform(iw,sun+[0])[:3])
 fills=[{'dir':norm([-.8,.1,.59]),'rgb':[.12,.18,.24],'intensity':.45},{'dir':norm([.2,.9,.387]),'rgb':[.28,.16,.08],'intensity':.35}]
 f32=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
 def mul(*vs):
  z=f32(vs[0])
  for v in vs[1:]:z=f32(z*f32(v))
  return z
 coeff=[[0.0]*9 for _ in range(3)]
 for channel in range(3):coeff[channel][0]=mul(ambient[channel],3.5449052)
 for light in fills:
  x,y,z=light['dir']
  for channel in range(3):
   color=mul(light['rgb'][channel],light['intensity'])
   adds=[mul(color,.282095,3.141593),mul(color,.488603,2.094395,y),mul(color,.488603,2.094395,z),mul(color,.488603,2.094395,x),mul(color,1.092548,.785398,y,x),mul(color,1.092548,.785398,z,y),mul(color,.315392,.785398,f32(mul(z,3,z)-1)),mul(color,1.092548,.785398,x,z),mul(color,.546274,.785398,f32(mul(x,x)-mul(y,y)))]
   coeff[channel]=[f32(a+b) for a,b in zip(coeff[channel],adds)]
 sh=[]
 for q in coeff:
  sh += [mul(q[8],.546274),mul(q[4],.546274),mul(q[7],.546274),mul(q[3],.2443015),mul(q[4],.546274),mul(q[8],-.546274),mul(q[5],.546274),mul(q[1],.2443015),mul(q[7],.546274),mul(q[5],.546274),mul(q[6],.946176),mul(q[2],.2443015),mul(q[3],.2443015),mul(q[1],.2443015),mul(q[2],.2443015),f32(mul(q[0],.282095)-mul(q[6],.315392))]
params['m_sphFill']=sh
for k,v in params.items():setv(fx,k,v)
if '--varied' in sys.argv:
 verts=[]
 corner_normals=[norm([-.35,.15,.92]),norm([.25,.35,.9]),norm([.4,-.3,.86]),norm([-.2,-.45,.87])]
 for corner,x,y,u,v in [(0,-.7,.7,0,0),(1,.7,.7,1,0),(2,.7,-.7,1,1),(0,-.7,.7,0,0),(2,.7,-.7,1,1),(3,-.7,-.7,0,1)]:
  n=corner_normals[corner];t=norm([n[2],0,-n[0]]);b=[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]]
  verts +=[x,y,.1]+n+[u,v]+t+b
else:
 verts=[]
 for x,y,u,v in [(-1,1,0,0),(1,1,1,0),(1,-1,1,1),(-1,1,0,0),(1,-1,1,1),(-1,-1,0,1)]:verts +=[x,y,.5,0,0,1,u,v,1,0,0,0,1,0]
va=(F*len(verts))(*verts);decl=P();els=(VE*6)(VE(0,0,2,0,0,0),VE(0,12,2,0,3,0),VE(0,24,1,0,5,0),VE(0,32,2,0,6,0),VE(0,44,2,0,7,0),VE(0xff,0,17,0,0,0));call(device,86,[els,c.byref(decl)],[c.POINTER(VE),c.POINTER(P)],'decl');call(device,87,[decl],[P])
mat=(F*16)(*ident)
for st in (2,3,256):
 a=(F*16)(*(world_data if st==256 and '--varied' in sys.argv else ident));call(device,44,[st,a],[U,P])

def begin(eff,tn):
 th=m(eff,13,P,[c.c_char_p])(eff,tn.encode());call(eff,58,[th],[P],'tech');np=U();call(eff,63,[c.byref(np),1],[c.POINTER(U),U],'begin effect')
def end(eff):call(eff,67,[],[],'end effect')
def apply_global():
 begin(globalfx,'t0');call(globalfx,64,[0],[U]);call(globalfx,66,[],[]);end(globalfx)
 for i in range(3):
  light=LIGHT();light.type=3;light.diffuse=C4(*(sd if i==0 else [x*fills[i-1]['intensity'] for x in fills[i-1]['rgb']] if '--varied' in sys.argv else [0,0,0]),1);light.specular=C4(*(sp if i==0 else [0,0,0]),0);light.ambient=C4(*(ambient if i==0 else [0,0,0]),1 if i==0 else 0);light.direction=V3(*[-x for x in (sun if i==0 or '--varied' not in sys.argv else fills[i-1]['dir'])]);light.range=1e6;light.falloff=1;light.att0=1;light.theta=3.141593;light.phi=3.141593
  call(device,51,[i,c.byref(light)],[U,c.POINTER(LIGHT)]);call(device,53,[i,1],[U,B])
 for st,val in [(7,0),(22,1),(28,0),(139,0)]:call(device,57,[st,val],[U,U])
 call(device,87,[decl],[P])
def render(tn,label,vertices=None,viewport=None,cull=1):
 apply_global();call(device,47,[c.byref(VP(0,0,N,N,0,1))],[c.POINTER(VP)]);call(device,43,[0,None,1,0x0d05070b,1.0,0],[U,P,U,U,F,U],'clear');call(device,47,[c.byref(VP(*(viewport or [0,0,N,N]),0,1))],[c.POINTER(VP)]);call(device,57,[22,cull],[U,U]);call(device,41,[],[],'BeginScene');begin(fx,tn);call(fx,64,[0],[U],'BeginPass');draw=verts if vertices is None else vertices;data=(F*len(draw))(*draw);call(device,83,[4,len(draw)//42,data,56],[U,U,P,U],'draw '+tn);call(fx,66,[],[],'EndPass');end(fx);call(device,42,[],[],'EndScene');call(device,32,[rt,readback],[P,P],'GetRTData');lr=LR();call(readback,13,[c.byref(lr),None,0x10],[c.POINTER(LR),P,U],'lock readback');rgba=bytearray()
 for y in range(N):
  row=c.string_at(lr.bits+y*lr.pitch,4*N)
  for x in range(N):j=x*4;rgba+=bytes([row[j+2],row[j+1],row[j],row[j+3]])
 call(readback,14,[],[],'unlock');samples={f'{x},{y}':list(rgba[(y*N+x)*4:(y*N+x+1)*4]) for x,y in [(0,0),(1,1),(8,8),(16,16),(24,8),(8,24),(31,31),(16,8),(8,16)]};print(label,samples,flush=True);return{'technique':tn,'rgbaBase64':base64.b64encode(rgba).decode(),'samples':samples}
results=[]
for tn in ('sph_t3','sph_t2','t0'):results.append(render(tn,tn))
center_tex=textures['BaseTexture'].copy()
for i in range(3,16,4):center_tex[i]=255
flat_cloud=[0,0,0,0]*4
bt=tex(center_tex);ct=tex(flat_cloud);call(fx,52,[par(fx,'BaseTexture'),bt],[P,P]);call(fx,52,[par(fx,'CloudTexture'),ct],[P,P]);setv(fx,'Diffuse',[0,0,0]);setv(fx,'Emissive',[.5,.5,.5]);setv(fx,'m_lightScale',[1,1,1,1]);center=render('t0','pixel_centers')
out={'width':N,'height':N,'origin':'top-left','format':'RGBA8','source':'Original Planet.fxo via native Direct3D9 HAL hardware vertex processing; no Present; identity matrices; original Global.fxo defaults applied','effectSha256':hashlib.sha256(fxb).hexdigest(),'textures':textures,'parameters':params,'sunDir':sun,'sunDiffuse':sd,'sunSpecular':sp,'ambient':ambient,'vertices':verts,'strideFloats':14,'results':results,'pixelCenterFixture':{'base':center_tex,'cloud':flat_cloud,'parametersOverride':{'Diffuse':[0,0,0],'Emissive':[.5,.5,.5],'m_lightScale':[1,1,1,1]},**center}}
if '--varied' in sys.argv:out.update(fills=fills,worldPhysicalRows=world,worldInversePhysicalRows=iw,cornerNormals=corner_normals,nativeSHCoefficientsRGB=coeff)
pathlib.Path(sys.argv[2]).write_text(json.dumps(out,separators=(',',':')));print('saved native fixture',flush=True)

if '--boundaries' in sys.argv:
 for k,t in texobjs.items():call(fx,52,[par(fx,k),t],[P,P])
 for k,v in params.items():setv(fx,k,v)
 def polygon(points):
  out=[]
  for x,y in points:out += [x,y,.5,0,0,1,(x+1)*.5,(1-y)*.5,1,0,0,0,1,0]
  return out
 def quad(l,t,r,b):return polygon([(l,t),(r,t),(r,b),(l,t),(r,b),(l,b)])
 cases=[
  {'name':'viewport integer corners','vertices':quad(-1,1,1,-1)},
  {'name':'offset non-square viewport','viewport':[3,5,23,19],'vertices':quad(-1,1,1,-1)},
  {'name':'interior integer horizontal and vertical edges','vertices':quad(-.75,.75,.25,-.25)},
  {'name':'viewport crossing polygon','vertices':quad(-1.5,1.5,1.5,-1.5)},
  {'name':'diagonal shared pixel centers','vertices':polygon([(-1,1),(1,1),(-1,-1)])},
  {'name':'fractional pixel edges','vertices':quad(-.984375,.953125,.609375,-.578125)},
  {'name':'counterclockwise native culling','nativeCull':3,'vertices':quad(-1,1,1,-1)},
  {'name':'clockwise native culling','nativeCull':2,'vertices':quad(-1,1,1,-1)},
 ]
 for case in cases:
  case['results']=[render(tn,case['name']+' '+tn,case['vertices'],case.get('viewport'),case.get('nativeCull',1)) for tn in ('sph_t3','sph_t2','t0')]
 out.pop('results');out.pop('vertices');out.pop('pixelCenterFixture');out['cases']=cases
 out['source']='Original Planet.fxo via native Direct3D9 HAL; integer and fractional edge coverage, clipping, offset viewport and one-sided culling; original Global.fxo defaults applied'
 pathlib.Path(sys.argv[2]).write_text(json.dumps(out,separators=(',',':')));print('saved native boundary fixtures',flush=True)
