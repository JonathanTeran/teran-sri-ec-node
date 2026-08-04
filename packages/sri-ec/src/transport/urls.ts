import { Ambiente } from '../catalogs/index.js';

/** URLs (sin `?wsdl`: se invoca por POST directo, no vía `SoapClient`/WSDL) de los web services offline del SRI, por ambiente. Port de `Psr18SoapTransport::ENDPOINTS`. */
export interface SriEndpoints {
  recepcion: string;
  autorizacion: string;
}

/**
 * Registro `Ambiente` → endpoints. `pruebas` usa el host `celcer` (Comprobantes
 * Electrónicos de CERtificación); `producción` usa `cel` — no confundir ambos
 * hosts entre sí (copiado literal de `Psr18SoapTransport::ENDPOINTS`).
 */
export const SRI_URLS: Record<Ambiente, SriEndpoints> = {
  [Ambiente.Pruebas]: {
    recepcion: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
    autorizacion:
      'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline',
  },
  [Ambiente.Produccion]: {
    recepcion: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
    autorizacion: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline',
  },
};
