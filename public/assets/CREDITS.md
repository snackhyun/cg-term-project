
## character/

- `character/character-female-b.glb`, `character/Textures/colormap.png` — "Mini Characters" (2.0) by Kenney, https://kenney.nl/assets/mini-characters — CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Original clips used: idle, walk, sprint, jump, interact-right (arm/torso/head tracks); leg and root tracks for walk/run/jump are generated procedurally in `src/character/gait.js`.

## textures/

All from Poly Haven (https://polyhaven.com), CC0 1.0 Universal (https://polyhaven.com/license, also stated on each asset page). 1K JPG maps (color = diffuse, normal = OpenGL normal, arm = AO/roughness/metal), re-encoded to smaller JPEGs; grass downscaled to 512 px.

- `textures/laminate_floor_02/` — "Laminate Floor 02" by Dario Barresi, Charlotte Baglioni, https://polyhaven.com/a/laminate_floor_02 — floor
- `textures/white_stucco/` — "White Stucco" by Amal Kumar, https://polyhaven.com/a/white_stucco — interior walls, ceiling
- `textures/white_plaster_02/` — "White Plaster 02" by Rob Tuytel, https://polyhaven.com/a/white_plaster_02 — exposed concrete sections, floor bands, roof
- `textures/painted_plaster_wall/` — "Painted Plaster Wall" by Amal Kumar, https://polyhaven.com/a/painted_plaster_wall — exterior facade
- `textures/leafy_grass/` — "Leafy Grass" by Charlotte Baglioni, https://polyhaven.com/a/leafy_grass — ground
- `textures/hexagonal_concrete_paving/` — "Hexagonal Concrete Paving" by Stephan Seeliger, https://polyhaven.com/a/hexagonal_concrete_paving — paving around the building

## furniture/

- `furniture/*.glb` — "Furniture Kit" (2.0) by Kenney, https://kenney.nl/assets/furniture-kit — CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/, stated on the asset page and in the kit's License.txt). Unmodified glTF binaries; materials are replaced at load time with the project's own palette (`src/render/materials.js`).
  Files: bedSingle, bookcaseClosed, bookcaseClosedWide, cabinetBedDrawerTable, cabinetTelevision, chairDesk, desk, kitchenCabinet, kitchenCabinetUpper, kitchenFridge, kitchenSink, kitchenStove, lampRoundFloor, loungeDesignSofa, loungeSofa, pottedPlant, sideTable, televisionModern.

## env/

- No image assets. Sky and environment lighting are procedural (gradient sky rendered into a PMREM environment map, `src/render/environment.js`).
