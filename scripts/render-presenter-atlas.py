"""Render a reusable animated 3D presenter atlas with Blender.

Run with:
  blender -b --python scripts/render-presenter-atlas.py -- --out-dir /tmp/presenter-frames

The atlas contains seven facial expressions and four speech mouth shapes per
expression. The video renderer changes atlas cells deterministically per frame.
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector


def args_after_separator():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--width", type=int, default=480)
    parser.add_argument("--height", type=int, default=620)
    parser.add_argument("--emotion", choices=("curiosity", "surprise", "tension", "empathy", "wonder", "confidence", "focus"))
    parser.add_argument("--mouth", type=int, choices=range(4))
    parser.add_argument("--engine", choices=("BLENDER_EEVEE", "CYCLES", "BLENDER_WORKBENCH"), default="BLENDER_EEVEE")
    parser.add_argument("--samples", type=int, default=48)
    return parser.parse_args(values)


def material(name, color, roughness=0.55, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.roughness = roughness
    mat.metallic = metallic
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (0, 0)
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (280, 0)
    mat.node_tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    for input_name, value in (("Subsurface Weight", 0.055), ("Subsurface Scale", 0.10), ("Coat Weight", 0.12), ("Coat Roughness", 0.34)):
        if input_name in principled.inputs:
            principled.inputs[input_name].default_value = value
    return mat


def sphere(name, location, scale, mat, segments=32, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def curve(name, points, mat, radius=0.018):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 16
    data.bevel_depth = radius
    data.bevel_resolution = 4
    spline = data.splines.new("NURBS")
    spline.order_u = min(4, len(points))
    spline.use_endpoint_u = True
    spline.resolution_u = 16
    spline.points.add(len(points) - 1)
    for p, co in zip(spline.points, points):
        p.co = (*co, 1.0)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def surface_mesh(name, vertices, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def make_mascot_torso(mat):
    vertices, faces = [], []
    segments, rings = 56, 32
    for j in range(rings + 1):
        t = j / rings
        z = 0.02 + 1.10 * t
        shoulder = 1.0 + 0.045 * math.sin(math.pi * t)
        width = 0.45 + 0.19 * math.exp(-((t - 0.63) / 0.30) ** 2)
        taper_t = min(1.0, max(0.0, (t - 0.80) / 0.20))
        taper = 1.0 - 0.62 * taper_t * taper_t * (3.0 - 2.0 * taper_t)
        width *= shoulder * taper
        depth = 0.28 - 0.045 * t
        for i in range(segments):
            a = 2 * math.pi * i / segments
            vertices.append((width * math.cos(a), -depth * math.sin(a), z))
    for j in range(rings):
        for i in range(segments):
            a = j * segments + i
            b = j * segments + (i + 1) % segments
            faces.append((a, a + segments, b + segments, b))
    return surface_mesh("ceramic armored torso", vertices, faces, mat)


def torso_front_y(x, z, offset=0.0):
    t = min(1.0, max(0.0, (z - 0.02) / 1.10))
    shoulder = 1.0 + 0.045 * math.sin(math.pi * t)
    width = 0.45 + 0.19 * math.exp(-((t - 0.63) / 0.30) ** 2)
    taper_t = min(1.0, max(0.0, (t - 0.80) / 0.20))
    taper = 1.0 - 0.62 * taper_t * taper_t * (3.0 - 2.0 * taper_t)
    width *= shoulder * taper
    depth = 0.28 - 0.045 * t
    normalized_x = min(0.985, max(-0.985, x / width))
    return -depth * math.sqrt(max(0.02, 1.0 - normalized_x * normalized_x)) - offset


def capsule_between(name, start, end, radius, depth, mat):
    start_vec, end_vec = Vector(start), Vector(end)
    direction = end_vec - start_vec
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=28, location=(start_vec + end_vec) * 0.5)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (radius, depth, direction.length * 0.5 + radius * 0.58)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def make_chest_panel(shell, gold, light):
    # Painel de armadura acompanha a curvatura do tronco em vez de flutuar
    # como um disco sobre o peito.
    outline = [(0.00, 0.805), (-0.12, 0.790), (-0.195, 0.715), (-0.19, 0.555),
               (-0.13, 0.445), (0.00, 0.395), (0.13, 0.445), (0.19, 0.555),
               (0.195, 0.715), (0.12, 0.790)]
    center = (0.0, 0.595)
    vertices = [(0.0, torso_front_y(center[0], center[1], 0.018), center[1])]
    vertices.extend((x, torso_front_y(x, z, 0.018), z) for x, z in outline)
    faces = [(0, i + 1, (i + 1) % len(outline) + 1) for i in range(len(outline))]
    panel = surface_mesh("fitted ceramic chest shield", vertices, faces, shell)
    solidify = panel.modifiers.new("integrated shield thickness", "SOLIDIFY")
    solidify.thickness = 0.035
    solidify.offset = -1.0
    bevel = panel.modifiers.new("soft shield edges", "BEVEL")
    bevel.width = 0.014
    bevel.segments = 3
    panel.modifiers.new("weighted shield normals", "WEIGHTED_NORMAL")

    trim_points = [(x, torso_front_y(x, z, 0.041), z) for x, z in outline]
    trim_points.append(trim_points[0])
    curve("fine warm shield inlay", trim_points, gold, 0.0045)
    for index, z in enumerate((0.575, 0.605, 0.635)):
        half_width = 0.055 if index == 1 else 0.039
        points = [(-half_width, torso_front_y(-half_width, z, 0.048), z),
                  (0.0, torso_front_y(0.0, z, 0.048), z + (0.006 if index == 1 else 0.0)),
                  (half_width, torso_front_y(half_width, z, 0.048), z)]
        curve("cyan chest status mark", points, light, 0.008)


def make_robot_arms(emotion, shell, teal, gold, glass):
    # Braços com ombro, braço superior, junta, antebraço e luva visíveis.
    # Cada linha é (cotovelo x/z, pulso x/z); x é espelhado por lado.
    poses = {
        "curiosity": (((0.72, 0.55), (0.56, 0.32)), ((0.76, 0.65), (0.70, 0.78))),
        "surprise": (((0.73, 0.62), (0.72, 0.80)), ((0.73, 0.62), (0.72, 0.80))),
        "tension": (((0.72, 0.53), (0.57, 0.30)), ((0.72, 0.53), (0.57, 0.30))),
        "empathy": (((0.69, 0.55), (0.29, 0.33)), ((0.69, 0.55), (0.29, 0.33))),
        "wonder": (((0.70, 0.67), (0.78, 0.69)), ((0.70, 0.67), (0.78, 0.69))),
        "confidence": (((0.72, 0.48), (0.56, 0.30)), ((0.72, 0.48), (0.56, 0.30))),
        "focus": (((0.72, 0.52), (0.57, 0.30)), ((0.72, 0.52), (0.57, 0.30))),
    }
    side_poses = poses.get(emotion, poses["focus"])
    raised_hands = emotion in ("surprise", "wonder")
    for index, side in enumerate((-1, 1)):
        (elbow_x, elbow_z), (wrist_x, wrist_z) = side_poses[index]
        elbow = (side * elbow_x, -0.205, elbow_z)
        wrist = (side * wrist_x, -0.355, wrist_z)
        shoulder = (side * 0.515, -0.085, 0.815)
        hand = (side * (wrist_x - (0.025 if wrist_x > 0.4 else 0.0)), -0.38,
                wrist_z + (0.105 if raised_hands else -0.105))

        # O encaixe começa dentro do ombro e continua para o cotovelo, sem
        # deixar as antigas ombreiras isoladas do restante do corpo.
        sphere("integrated shoulder yoke", (side * 0.535, -0.105, 0.815),
               (0.128, 0.135, 0.142), teal, 40, 28)
        capsule_between("teal upper arm", shoulder, elbow, 0.100, 0.112, teal)
        sphere("gold elbow bearing", elbow, (0.078, 0.070, 0.078), gold, 32, 20)
        sphere("elbow inset", (elbow[0], elbow[1] - 0.068, elbow[2]),
               (0.036, 0.014, 0.036), glass, 24, 16)
        capsule_between("porcelain forearm", elbow, wrist, 0.088, 0.096, shell)
        capsule_between("teal wrist cuff", wrist, (wrist[0], wrist[1] - 0.004, wrist[2] + (0.025 if raised_hands else -0.025)),
                        0.071, 0.078, teal)
        sphere("soft articulated palm", hand, (0.090, 0.066, 0.089), shell, 32, 20)

        finger_direction = 1.0 if raised_hands else -1.0
        for finger_index, spread in enumerate((-1, 0, 1)):
            start = (hand[0] + side * spread * 0.039, hand[1] - 0.008, hand[2] + finger_direction * 0.038)
            end = (hand[0] + side * spread * 0.050, hand[1] - 0.012,
                   hand[2] + finger_direction * (0.105 if spread == 0 else 0.092))
            capsule_between("rounded glove finger", start, end, 0.020, 0.022, shell)
        thumb_start = (hand[0] - side * 0.074, hand[1] - 0.005, hand[2] - finger_direction * 0.005)
        thumb_end = (hand[0] - side * 0.125, hand[1] - 0.018, hand[2] + finger_direction * 0.025)
        capsule_between("rounded glove thumb", thumb_start, thumb_end, 0.026, 0.027, shell)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def add_area(name, location, power, size, color, target=(0, 0, 1.1)):
    bpy.ops.object.light_add(type="AREA", location=location)
    light = bpy.context.object
    light.name = name
    light.data.energy = power
    light.data.shape = "DISK"
    light.data.size = size
    light.data.color = color
    light.rotation_euler = (Vector(target) - light.location).to_track_quat("-Z", "Y").to_euler()


def emissive_material(name, color, strength=1.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (*color, 1.0)
    emission.inputs["Strength"].default_value = strength
    output = nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat


def build_character(emotion, mouth_index):
    shell = material("porcelain shell", (0.77, 0.84, 0.84), 0.26)
    shell_bsdf = next(node for node in shell.node_tree.nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
    shell_bsdf.inputs["Coat Weight"].default_value = 0.38
    shell_bsdf.inputs["Coat Roughness"].default_value = 0.20
    teal = material("deep teal armor", (0.018, 0.13, 0.16), 0.36, 0.18)
    glass = material("dark glass face", (0.006, 0.025, 0.038), 0.14, 0.28)
    gold = material("warm titanium accents", (0.58, 0.30, 0.10), 0.27, 0.62)
    eye_glow = emissive_material("soft cyan expression lights", (0.20, 0.90, 1.0), 1.4)
    eye_core = material("blue glass pupils", (0.015, 0.11, 0.15), 0.16, 0.18)
    mouth_glow = emissive_material("aqua smile light", (0.20, 0.78, 0.84), 1.2)
    amber_glow = emissive_material("amber status light", (1.0, 0.43, 0.10), 1.5)

    # Um apresentador de IA original: carcaça de cerâmica, visor de vidro e
    # rosto digital expressivo. Todas as peças são geometria renderizada no Blender.
    make_mascot_torso(teal)
    sphere("neck joint", (0, 0.0, 1.045), (0.17, 0.17, 0.17), gold)
    sphere("head shell", (0, 0.025, 1.68), (0.55, 0.46, 0.59), shell, 64, 40)
    sphere("visor warm rim", (0, -0.386, 1.70), (0.427, 0.075, 0.324), gold, 64, 40)
    sphere("visor bezel", (0, -0.421, 1.70), (0.407, 0.076, 0.307), teal, 64, 40)
    sphere("glass visor", (0, -0.455, 1.70), (0.379, 0.065, 0.278), glass, 64, 40)

    # Módulos laterais pequenos mantêm a silhueta legível em telas de celular.
    for side in (-1, 1):
        sphere("ear module", (side * 0.526, 0.005, 1.69), (0.115, 0.16, 0.17), shell, 40, 28)
        sphere("ear module inset", (side * 0.584, -0.038, 1.69), (0.065, 0.10, 0.105), teal, 32, 20)
        sphere("ear status light", (side * 0.624, -0.052, 1.69), (0.018, 0.032, 0.034), amber_glow, 20, 12)

    # Antena curta com um único ponto âmbar, como assinatura visual do canal.
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.027, depth=0.145, location=(0, 0.025, 2.31))
    antenna = bpy.context.object
    antenna.name = "short antenna stem"
    antenna.data.materials.append(gold)
    bevel = antenna.modifiers.new("rounded antenna edges", "BEVEL")
    bevel.width = 0.022
    bevel.segments = 4
    sphere("antenna light", (0, 0.025, 2.397), (0.060, 0.060, 0.060), amber_glow, 32, 20)

    brow_raise = {"curiosity": 0.006, "surprise": 0.088, "tension": -0.040, "empathy": 0.045,
                  "wonder": 0.072, "confidence": -0.006, "focus": -0.052}.get(emotion, 0.0)
    eye_height = {"curiosity": 0.080, "surprise": 0.126, "tension": 0.052, "empathy": 0.072,
                  "wonder": 0.115, "confidence": 0.070, "focus": 0.055}.get(emotion, 0.080)
    eye_width = 0.073 if emotion == "surprise" else (0.060 if emotion in ("tension", "focus", "confidence") else 0.068)
    for side in (-1, 1):
        x = side * 0.155
        z = 1.755 + brow_raise
        sphere("glowing eye", (x, -0.512, z), (eye_width, 0.018, eye_height), eye_glow, 40, 24)
        sphere("eye center", (x + 0.004, -0.531, z), (eye_width * 0.28, 0.009, eye_height * 0.48), eye_core, 32, 20)
        sphere("eye highlight", (x - 0.016, -0.541, z + eye_height * 0.24), (0.011, 0.006, 0.012), shell, 20, 12)
        brow_z = 1.884 + brow_raise + (0.022 if emotion == "curiosity" and side > 0 else 0.0)
        outer_lift = 0.025 if emotion == "empathy" else (0.018 if emotion == "wonder" else 0.0)
        inner_drop = 0.045 if emotion in ("tension", "focus") else 0.0
        outer_x = x + side * 0.080
        inner_x = x - side * 0.080
        curve("expressive visor brow", [
            (outer_x, -0.498, brow_z + outer_lift),
            (x + side * 0.040, -0.526, brow_z + 0.018),
            (x - side * 0.012, -0.531, brow_z + 0.020 - inner_drop * 0.55),
            (inner_x, -0.500, brow_z - inner_drop)
        ], mouth_glow, 0.009)

    mouth_z = 1.535
    mouth_width = 0.093 if mouth_index != 2 else 0.105
    if mouth_index == 0:
        if emotion == "surprise":
            sphere("surprised open mouth", (0, -0.522, mouth_z), (0.032, 0.016, 0.047), glass, 32, 20)
            bpy.ops.mesh.primitive_torus_add(major_radius=0.037, minor_radius=0.006, major_segments=32, minor_segments=10,
                                             location=(0, -0.540, mouth_z), rotation=(math.pi / 2, 0, 0))
            bpy.context.object.data.materials.append(mouth_glow)
        else:
            corners_up = emotion in ("empathy", "wonder", "confidence")
            center_drop = 0.016 if emotion in ("tension", "focus") else 0.010
            corner_lift = 0.022 if corners_up else (-0.002 if emotion == "curiosity" else -0.006)
            curve("resting digital expression", [(-mouth_width, -0.514, mouth_z + corner_lift),
                                                   (-mouth_width * 0.52, -0.536, mouth_z - center_drop * 0.60),
                                                   (0, -0.541, mouth_z - center_drop),
                                                   (mouth_width * 0.52, -0.536, mouth_z - center_drop * 0.60),
                                                   (mouth_width, -0.514, mouth_z + corner_lift)], mouth_glow, 0.012)
    else:
        height = {1: 0.021, 2: 0.059, 3: 0.038}[mouth_index]
        sphere("speaking mouth", (0, -0.514, mouth_z), (mouth_width, 0.012, height), glass, 32, 20)
        curve("speaking mouth lower glow", [(-mouth_width * 0.72, -0.526, mouth_z - height * 0.60),
                                             (0, -0.540, mouth_z - height * 0.76),
                                             (mouth_width * 0.72, -0.526, mouth_z - height * 0.60)], mouth_glow, 0.009)

    make_chest_panel(shell, gold, mouth_glow)
    make_robot_arms(emotion, shell, teal, gold, glass)


def setup_scene(width, height, engine, samples):
    scene = bpy.context.scene
    scene.render.engine = engine
    if engine == "BLENDER_EEVEE":
        scene.eevee.taa_render_samples = max(8, samples)
    elif engine == "CYCLES":
        scene.cycles.samples = max(8, samples)
        scene.cycles.use_denoising = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = "/tmp/presenter_cell.png"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.28, 0.33, 0.40, 1.0)
    background.inputs["Strength"].default_value = 0.34
    # Key frontal, fill contido e duas luzes de recorte dão volume ao esmalte
    # e deixam as juntas legíveis contra fundos escuros.
    add_area("warm sculpting key", (-3.0, -4.0, 4.5), 350, 3.0, (1.0, 0.82, 0.68), target=(0, 0, 1.35))
    add_area("soft frontal fill", (0.0, -4.2, 2.1), 82, 4.0, (1.0, 0.91, 0.82), target=(0, 0, 1.2))
    add_area("cool side fill", (3.2, -2.4, 2.7), 105, 2.4, (0.72, 0.81, 1.0), target=(0, 0, 1.3))
    add_area("warm rear contour", (0.6, 2.4, 3.8), 210, 2.2, (0.75, 0.55, 0.34), target=(0, 0, 1.5))
    add_area("cyan rear rim", (3.0, 1.1, 2.6), 170, 2.0, (0.24, 0.78, 1.0), target=(0, 0, 1.15))
    bpy.ops.object.camera_add(location=(2.8, -8.0, 1.52))
    camera = bpy.context.object
    camera.name = "presenter camera"
    camera.data.type = "PERSP"
    camera.data.sensor_fit = "VERTICAL"
    camera.data.lens = 72.0
    camera.rotation_euler = (Vector((0.0, 0.0, 1.18)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera


def main():
    options = args_after_separator()
    os.makedirs(options.out_dir, exist_ok=True)
    emotions = (options.emotion,) if options.emotion else ("curiosity", "surprise", "tension", "empathy", "wonder", "confidence", "focus")
    for row, emotion in enumerate(emotions):
        row = ("curiosity", "surprise", "tension", "empathy", "wonder", "confidence", "focus").index(emotion)
        for col in ((options.mouth,) if options.mouth is not None else range(4)):
            clear_scene()
            setup_scene(options.width, options.height, options.engine, options.samples)
            build_character(emotion, col)
            path = os.path.join(options.out_dir, f"r{row}c{col}.png")
            bpy.context.scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            print(f"Rendered {emotion} mouth={col}: {path}", flush=True)


if __name__ == "__main__":
    main()
