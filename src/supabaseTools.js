import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

export async function executeFunction(name, args = {}) {
  try {
    switch (name) {
      case 'buscar_ciudades':
        return await buscarCiudades(args.filtro)
      case 'buscar_rutas':
        return await buscarRutas(args.ciudad_origen, args.ciudad_destino)
      case 'buscar_viajes':
        return await buscarViajes(args.ciudad_origen, args.ciudad_destino, args.fecha)
      default:
        return { error: `Función desconocida: ${name}` }
    }
  } catch (error) {
    console.error(`Error en ${name}:`, error.message)
    return { error: `Error al ejecutar ${name}: ${error.message}` }
  }
}

async function buscarCiudades(filtro) {
  let query = supabase
    .from('ciudades')
    .select('id, nombre, departamentos(nombre)')
    .order('nombre')

  if (filtro && filtro.trim()) {
    query = query.ilike('nombre', `%${filtro.trim()}%`)
  }

  const { data, error } = await query.limit(25)
  if (error) return { error: error.message }

  return {
    total: data.length,
    ciudades: data.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      departamento: c.departamentos?.nombre || 'N/A',
    })),
  }
}

async function buscarRutas(ciudadOrigen, ciudadDestino) {
  let origenId = null
  let destinoId = null

  if (ciudadOrigen) {
    const { data } = await supabase
      .from('ciudades')
      .select('id, nombre')
      .ilike('nombre', `%${ciudadOrigen.trim()}%`)
      .limit(1)
      .maybeSingle()
    if (data) origenId = data.id
    else return { error: `No se encontró la ciudad "${ciudadOrigen}"` }
  }

  if (ciudadDestino) {
    const { data } = await supabase
      .from('ciudades')
      .select('id, nombre')
      .ilike('nombre', `%${ciudadDestino.trim()}%`)
      .limit(1)
      .maybeSingle()
    if (data) destinoId = data.id
    else return { error: `No se encontró la ciudad "${ciudadDestino}"` }
  }

  let query = supabase.from('rutas').select(`
    id, duracion,
    origen:ciudades!rutas_ciudad_origen_id_fkey(id, nombre),
    destino:ciudades!rutas_ciudad_destino_id_fkey(id, nombre)
  `)

  if (origenId) query = query.eq('ciudad_origen_id', origenId)
  if (destinoId) query = query.eq('ciudad_destino_id', destinoId)

  const { data, error } = await query
  if (error) return { error: error.message }

  if (!data || data.length === 0) {
    return {
      message: 'No se encontraron rutas con esos criterios.',
      ciudad_origen: ciudadOrigen || 'cualquiera',
      ciudad_destino: ciudadDestino || 'cualquiera',
    }
  }

  return {
    total: data.length,
    rutas: data.map((r) => {
      const duracionMin = r.duracion || 0
      const horas = Math.floor(duracionMin / 60)
      const minutos = duracionMin % 60
      const precioEstimado = Math.round((10000 + duracionMin * 130) / 1000) * 1000

      return {
        id: r.id,
        origen: r.origen?.nombre,
        destino: r.destino?.nombre,
        duracion: minutos > 0 ? `${horas}h ${minutos}min` : `${horas}h`,
        duracion_minutos: duracionMin,
        precio_estimado: precioEstimado,
        precio_formateado: `$${precioEstimado.toLocaleString('es-CO')}`,
      }
    }),
  }
}

async function buscarViajes(ciudadOrigen, ciudadDestino, fecha) {
  const { data: origen } = await supabase
    .from('ciudades')
    .select('id, nombre')
    .ilike('nombre', `%${ciudadOrigen.trim()}%`)
    .limit(1)
    .maybeSingle()

  const { data: destino } = await supabase
    .from('ciudades')
    .select('id, nombre')
    .ilike('nombre', `%${ciudadDestino.trim()}%`)
    .limit(1)
    .maybeSingle()

  if (!origen) {
    return { error: `No se encontró la ciudad de origen "${ciudadOrigen}"` }
  }
  if (!destino) {
    return { error: `No se encontró la ciudad de destino "${ciudadDestino}"` }
  }

  let query = supabase
    .from('viajes')
    .select(`
      id, bus_id, fecha, hora_salida, precio,
      rutas!viajes_ruta_id_fkey(
        id, duracion,
        origen:ciudades!rutas_ciudad_origen_id_fkey(id, nombre),
        destino:ciudades!rutas_ciudad_destino_id_fkey(id, nombre)
      )
    `)
    .order('fecha')
    .order('hora_salida')

  if (fecha) {
    query = query.eq('fecha', fecha)
  } else {
    const today = new Date().toISOString().split('T')[0]
    query = query.gte('fecha', today)
  }

  const { data, error } = await query.limit(50)
  if (error) return { error: error.message }


  let result = (data || []).filter(
    (v) =>
      v.rutas?.origen?.id === origen.id && v.rutas?.destino?.id === destino.id
  )

  if (fecha) {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    if (fecha === todayStr) {
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`
      result = result.filter((v) => v.hora_salida > currentTime)
    }
  }

  result = result.slice(0, 10)

  if (result.length === 0) {
    return {
      message: 'No se encontraron viajes para esta ruta y fecha.',
      origen: origen.nombre,
      destino: destino.nombre,
      fecha: fecha || 'próximos días',
      sugerencia: 'Intenta con otra fecha o consulta las rutas disponibles.',
    }
  }

  const viajes = await Promise.all(
    result.map(async (v) => {
      let asientosDisponibles = null
      try {
        const { count } = await supabase
          .from('reservas')
          .select('id', { count: 'exact', head: true })
          .eq('viaje_id', v.id)

        asientosDisponibles = 40 - (count || 0)
      } catch {
        asientosDisponibles = null 
      }

      const duracionMin = v.rutas?.duracion || 0
      const horas = Math.floor(duracionMin / 60)
      const minutos = duracionMin % 60

      return {
        id: v.id,
        fecha: v.fecha,
        hora_salida: v.hora_salida?.slice(0, 5),
        precio: v.precio,
        precio_formateado: `$${Number(v.precio).toLocaleString('es-CO')}`,
        origen: v.rutas?.origen?.nombre,
        destino: v.rutas?.destino?.nombre,
        duracion: minutos > 0 ? `${horas}h ${minutos}min` : `${horas}h`,
        asientos_disponibles: asientosDisponibles,
        capacidad_total: 40,
      }
    })
  )

  return {
    total: viajes.length,
    origen: origen.nombre,
    destino: destino.nombre,
    fecha: fecha || 'próximos días',
    viajes,
  }
}
