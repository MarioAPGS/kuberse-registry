import MyApp from './index'

/**
 * Wrapper de desarrollo.
 * Simula las props que kubrain pasaria al componente segun spec.app[].props del YAML.
 * Modifica las props para probar diferentes escenarios.
 */
export default function App() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 16, fontSize: 18, fontFamily: 'system-ui' }}>
        Dev Mode - My App
      </h1>
      <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden' }}>
        <MyApp
          apiHost="/api/v1/my-service"
        />
      </div>
    </div>
  )
}
