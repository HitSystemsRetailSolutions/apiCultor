import { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions, SASProtocol, StorageSharedKeyCredential } from '@azure/storage-blob';

export class getAzureSASTokenService {

    async generateSasUrl(blobName?: string, expiresInHours = 2): Promise<string> {
        const accountName = process.env.AZURE_STORAGE_ACCOUNT!;
        const accountKey = process.env.AZURE_STORAGE_KEY!;
        const containerName = "tickets";

        const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

        // Hora d’expiració del SAS
        const expiry = new Date();
        expiry.setHours(expiry.getHours() + expiresInHours);

        // Permisos (lectura, escriptura, creació, moure)
        const permissions = BlobSASPermissions.parse("rwcm");

        // Crear SAS
        const sasToken = generateBlobSASQueryParameters(
            {
                containerName,
                blobName, // opcional → si no el poses, serveix per tot el contenidor
                permissions,
                protocol: SASProtocol.Https,
                startsOn: new Date(),
                expiresOn: expiry,
            },
            sharedKeyCredential
        ).toString();

        // Retornar URL final
        const baseUrl = `https://${accountName}.blob.core.windows.net/${containerName}`;
        return blobName ? `${baseUrl}/${blobName}?${sasToken}` : `${baseUrl}?${sasToken}`;
    }
}