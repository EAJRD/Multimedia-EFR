/* Sonda: para saber si una función nueva en api/ arranca en este
   despliegue. Se borra en cuanto sepas qué responde. */
export const handler = async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, donde: 'sonda' }));
};