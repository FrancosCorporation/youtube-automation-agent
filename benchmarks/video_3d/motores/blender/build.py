"""Real Blender scene, glTF export and Eevee animation from the frozen contract."""
import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector,Matrix,Euler

BASE=Path(__file__).resolve().parents[2]
MODEL=json.loads((BASE/'shared/scene.json').read_text())
FRAMES=json.loads((BASE/'shared/frames.json').read_text())
BASIS=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
def point(p):return BASIS@Vector(p)
def color(h):
    c=[int(h[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c)+(1,)
def material(m,water=False):
    key=(m['color'],m.get('metalness',.12),water)
    if key in MATERIALS:return MATERIALS[key]
    mat=bpy.data.materials.new('surface-'+m['color']);mat.diffuse_color=color(m['color']);mat.use_nodes=True
    bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=color(m['color'])
    bs.inputs['Metallic'].default_value=.32 if water else m.get('metalness',.12)
    bs.inputs['Roughness'].default_value=.20 if water else .36
    bs.inputs['Coat Weight'].default_value=.65 if water else .12
    if water:
        noise=mat.node_tree.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=9;noise.inputs['Detail'].default_value=2
        bump=mat.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.13;bump.inputs['Distance'].default_value=.06
        mat.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']);mat.node_tree.links.new(bump.outputs['Normal'],bs.inputs['Normal'])
    MATERIALS[key]=mat;return mat
def mesh_part(m,name):
    typ=m['type'];s=m['size']
    if typ=='box':
        bpy.ops.mesh.primitive_cube_add(size=1);obj=bpy.context.object;obj.scale=(s[0],s[2],s[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    elif typ=='sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,radius=.5);obj=bpy.context.object;obj.scale=(s[0],s[2],s[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    elif typ=='cylinder':
        bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.5,depth=1);obj=bpy.context.object;obj.scale=(s[0],s[2],s[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    elif typ=='torus':
        bpy.ops.mesh.primitive_torus_add(major_segments=64,minor_segments=16,major_radius=.5,minor_radius=.12,rotation=(math.pi/2,0,0));obj=bpy.context.object;bpy.ops.object.transform_apply(location=False,rotation=True,scale=False);obj.scale=(s[0],s[2],s[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    elif typ=='extrude':
        points=m['points'];n=len(points)
        verts=[point((p[0]*s[0],p[1]*s[1],z)) for z in (0,s[2]) for p in points]
        faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    elif typ=='tube':
        curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.resolution_u=24;curve.bevel_depth=s[0];curve.bevel_resolution=4
        spline=curve.splines.new('BEZIER');spline.bezier_points.add(len(m['points'])-1)
        for b,p in zip(spline.bezier_points,m['points']):b.co=point(p);b.handle_left_type='AUTO';b.handle_right_type='AUTO'
        obj=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(obj);bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.convert(target='MESH');obj=bpy.context.object
    else:raise ValueError(typ)
    obj.name=name
    if typ in ('box','extrude','cylinder'):
        bevel=obj.modifiers.new('Authored rounded edges','BEVEL');bevel.width=min(.045,min(s)*.12);bevel.segments=3
        bevel.limit_method='ANGLE'
        if typ!='extrude':obj.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    obj.location=point(m['position']);rot=BASIS@Euler(m.get('rotation',[0,0,0]),'XYZ').to_matrix()@BASIS.transposed();obj.rotation_euler=rot.to_euler()
    obj.data.materials.append(material(m,name.startswith('water')))
    for poly in obj.data.polygons:poly.use_smooth=typ in ('sphere','torus','tube','cylinder')
    obj.select_set(False);return obj

bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
MATERIALS={};groups={}
for node in MODEL['nodes']:
    group=bpy.data.objects.new(node['id'],None);bpy.context.collection.objects.link(group);groups[node['id']]=group
    for i,m in enumerate(node['meshes']):mesh_part(m,f'{node["id"]}-part-{i}').parent=group

# Export neutral authored geometry BEFORE adding timeline transforms/lights/camera.
glb=BASE/'motores/hibrido/lock.blender.glb'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_apply=True,export_animations=False,export_yup=True)

scene=bpy.context.scene;scene.render.engine='CYCLES' if '--cycles' in sys.argv else 'BLENDER_EEVEE'
scene.render.resolution_x=1690;scene.render.resolution_y=670;scene.render.resolution_percentage=100
scene.render.fps=30;scene.frame_start=1;scene.frame_end=MODEL['durationInFrames']
scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='8';scene.render.image_settings.compression=15
scene.render.filepath=str(BASE/'motores/blender/frames/')+'/'
scene.render.threads_mode='FIXED';scene.render.threads=4
scene.world.color=(.04,.06,.08)
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=color('#b8d3d7');scene.world.node_tree.nodes['Background'].inputs[1].default_value=.35
scene.view_settings.view_transform='AgX'
eevee=getattr(scene,'eevee',None)
if eevee:
    for prop,value in [('taa_render_samples',64),('use_raytracing',True)]:
        if hasattr(eevee,prop):setattr(eevee,prop,value)

def light(name,pos,energy,col,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.color=color(col)[:3];data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.location=point(pos);obj.rotation_euler=(point([0,.3,0])-obj.location).to_track_quat('-Z','Y').to_euler()
light('Large warm key',[-4,8,6],2200,'#fff1d1',7)
light('Mint rim',[6,4,-4],1800,'#a3e0d3',6)
light('Soft front',[0,4,10],900,'#d7edff',8)
camdata=bpy.data.cameras.new('Cinematic camera');camera=bpy.data.objects.new('Cinematic camera',camdata);bpy.context.collection.objects.link(camera);scene.camera=camera
camdata.type='PERSP';camdata.sensor_fit='VERTICAL';camdata.sensor_height=24;camdata.lens=24/(2*math.tan(math.radians(MODEL['cameraFov'])/2));camdata.clip_start=.05;camdata.clip_end=100
camdata.dof.use_dof=True;camdata.dof.aperture_fstop=8

for index,state in enumerate(FRAMES):
    f=index+1
    for name,g in groups.items():
        s=state.get(name,{})
        g.location=point(s.get('position3d',[0,0,0]));rot=BASIS@Euler(s.get('rotation3d',[0,0,0]),'XYZ').to_matrix()@BASIS.transposed();g.rotation_euler=rot.to_euler()
        scale=s.get('scale3d',[1,1,1]);g.scale=(scale[0],scale[2],scale[1]);g.hide_render=s.get('opacity',1)<.01
        for prop in ('location','rotation_euler','scale','hide_render'):g.keyframe_insert(data_path=prop,frame=f)
    c=state['camera'];camera.location=point(c['position3d']);target=point(c['target3d']);camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.keyframe_insert(data_path='location',frame=f);camera.keyframe_insert(data_path='rotation_euler',frame=f);camdata.dof.focus_distance=(target-camera.location).length;camdata.dof.keyframe_insert(data_path='focus_distance',frame=f)

(BASE/'motores/blender/frames').mkdir(exist_ok=True)
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'motores/blender/eclusa.blend'))
props={'blender':bpy.app.version_string,'engine':scene.render.engine,'nativeFrameSize':[1690,670],'finalFrameSize':[1920,1080],'fps':30,'frames':scene.frame_end,'groups':len(groups),'glbBytes':glb.stat().st_size,'eeveeProperties':{p.identifier:str(getattr(eevee,p.identifier)) for p in eevee.bl_rna.properties if p.identifier in ['taa_render_samples','use_raytracing']} if eevee else None,'camera':'same frame-indexed position/target as A/B/D; Blender depth of field f/8','fluid':'procedural illustrative surface/level, not a fluid solver'}
(BASE/'motores/blender/build-info.json').write_text(json.dumps(props,indent=2)+'\n')
print('BENCHMARK_BLENDER_BUILT '+json.dumps(props))
if '--preview' in sys.argv:
    scene.frame_set(901);scene.render.filepath=str(BASE/'comparacoes/frames/C-native-preview.png');bpy.ops.render.render(write_still=True)
if '--render-all' in sys.argv:
    for frame in range(1,scene.frame_end+1):
        scene.frame_set(frame);scene.render.filepath=str(BASE/'motores/blender/frames'/f'{frame:05}.png')
        if not Path(scene.render.filepath).exists():bpy.ops.render.render(write_still=True)
