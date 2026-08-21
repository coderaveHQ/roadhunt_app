-- Roadhunt Germany import style for osm2pgsql 2.3.1 Flex output.
-- The raw tables are disposable staging data. Application tables are updated
-- only by publish.sql after all completeness checks have passed.

local schema = 'osm_import'

local boundaries = osm2pgsql.define_relation_table('admin_boundaries', {
    { column = 'name', type = 'text' },
    { column = 'name_en', type = 'text' },
    { column = 'admin_level', type = 'text' },
    { column = 'official_code', type = 'text' },
    { column = 'wikidata', type = 'text' },
    { column = 'place', type = 'text' },
    { column = 'de_place', type = 'text' },
    { column = 'population', type = 'text' },
    { column = 'iso_country_code', type = 'text' },
    { column = 'tags', type = 'jsonb' },
    { column = 'geom', type = 'multipolygon', projection = 4326 },
}, { schema = schema })

local roads = osm2pgsql.define_way_table('road_segments', {
    { column = 'name', type = 'text' },
    { column = 'highway', type = 'text' },
    { column = 'access', type = 'text' },
    { column = 'motor_vehicle', type = 'text' },
    { column = 'service', type = 'text' },
    { column = 'junction', type = 'text' },
    { column = 'geom', type = 'linestring', projection = 4326 },
}, { schema = schema })

local places = osm2pgsql.define_node_table('place_nodes', {
    { column = 'name', type = 'text' },
    { column = 'name_en', type = 'text' },
    { column = 'place', type = 'text' },
    { column = 'population', type = 'text' },
    { column = 'wikidata', type = 'text' },
    { column = 'geom', type = 'point', projection = 4326 },
}, { schema = schema })

local function has_eight_digit_official_code(value)
    return value ~= nil and string.match(value, '^%d%d%d%d%d%d%d%d$') ~= nil
end

function osm2pgsql.process_relation(object)
    local tags = object.tags
    if tags.boundary ~= 'administrative' then
        return
    end

    local keep = tags.admin_level == '2'
        or tags.admin_level == '4'
        or tags.admin_level == '6'
        or tags.admin_level == '8'
        or has_eight_digit_official_code(tags['de:amtlicher_gemeindeschluessel'])

    if not keep or tags.name == nil then
        return
    end

    boundaries:insert({
        name = tags.name,
        name_en = tags['name:en'],
        admin_level = tags.admin_level,
        official_code = tags['de:amtlicher_gemeindeschluessel'],
        wikidata = tags.wikidata,
        place = tags.place,
        de_place = tags['de:place'],
        population = tags.population,
        iso_country_code = tags['ISO3166-1'],
        tags = tags,
        geom = object:as_multipolygon(),
    })
end

function osm2pgsql.process_way(object)
    local tags = object.tags
    if tags.highway == nil or tags.name == nil then
        return
    end

    roads:insert({
        name = tags.name,
        highway = tags.highway,
        access = tags.access,
        motor_vehicle = tags.motor_vehicle,
        service = tags.service,
        junction = tags.junction,
        geom = object:as_linestring(),
    })
end

function osm2pgsql.process_node(object)
    local tags = object.tags
    if tags.place == nil or tags.name == nil then
        return
    end

    places:insert({
        name = tags.name,
        name_en = tags['name:en'],
        place = tags.place,
        population = tags.population,
        wikidata = tags.wikidata,
        geom = object:as_point(),
    })
end
