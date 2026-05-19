import { useState, useEffect } from 'react'

/**
 * Props que recibe el componente. Se definen en el YAML de la entidad:
 *
 *   spec:
 *     app:
 *       - component: https://...component.mjs
 *         props:
 *           apiHost: /api/v1/my-service
 *
 * Kubrain pasa estas props automaticamente al cargar el componente.
 */
interface MyAppProps {
  apiHost: string
  [key: string]: unknown
}

/**
 * Componente principal.
 *
 * REQUISITOS:
 * - DEBE ser el export default del modulo
 * - NO debe importar react de forma que lo bundlee (vite.config.ts lo marca como external)
 * - Puede usar cualquier hook de React (useState, useEffect, etc.)
 * - Puede hacer fetch al backend via apiHost (pasa por el gateway de kubrain)
 */
export default function MyApp({ apiHost }: MyAppProps) {
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`${apiHost}/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => {
        setData(json)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [apiHost])

  if (loading) {
    return <div style={{ padding: 16, fontFamily: 'system-ui' }}>Cargando...</div>
  }

  if (error) {
    return (
      <div style={{ padding: 16, color: '#dc2626', fontFamily: 'system-ui' }}>
        Error: {error}
      </div>
    )
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Respuesta del servicio</h2>
      <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, fontSize: 13 }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}
