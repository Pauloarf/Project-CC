/**
 * @module NetTask
 * 
 * Common definition of the NetTask Protocol. Used in both the AGENT and SERVER solutions for the implementation
 * of a responsive and resilient communication.
 * 
 * @copyright Copyright (c) 2024 DarkenLM https://github.com/DarkenLM
 */

import { ECDHE, HASH_LEN } from "$common/protocol/ecdhe.js";
import { BufferReader, BufferWriter } from "$common/util/buffer.js";
import { DefaultLogger, getOrCreateGlobalLogger } from "$common/util/logger.js";
import { _SPACKTask, deserializeSPACK, isSPACKTaskCollection, packTaskSchemas, serializedTaskMetric as serializeTaskMetric, serializeSPACK, SPACKPacked, SPACKTask, SPACKTaskCollectionPacked, SPACKTaskMetric, unpackTaskSchemas, deserializeTaskMetric } from "./spack.js";
import dedent from "$common/util/dedent.js";

//#region ============== Types ==============
interface NetTaskPublicHeader {
    cryptoMark: Buffer,
    sessionId: Buffer,
    payloadSize: number
};
//#endregion ============== Types ==============

//#region ============== Constants ==============
const NET_TASK_VERSION = 1;
const NET_TASK_SIGNATURE = Buffer.from("NTTK", "utf8");
const NET_TASK_CRYPTO    = Buffer.from("CC", "utf8");
const NET_TASK_NOCRYPTO  = Buffer.from("NC", "utf8");

enum NetTaskDatagramType {
    //#region ------- REGISTER PROCESS -------
    REQUEST_REGISTER,
    REGISTER_CHALLENGE,
    REGISTER_CHALLENGE2,
    CONNECTION_REJECTED,
    //#endregion ------- REGISTER PROCESS -------
    PUSH_SCHEMAS,
    SEND_METRICS,
    // REQUEST_METRICS,
    // RESPONSE_TASK,
    // RESPONSE_METRICS
};
//#endregion ============== Constants ==============
/**
 * This class represents a message datagram used between the Agent and Server solutions
 * to transmit tasks and metric colletions.
 */
class NetTask {
    protected sessionId: Buffer;
    protected cryptoMark: Buffer;
    protected version: number;
    protected sequenceNumber: number;
    protected fragmented: boolean;
    protected acknowledgementNumber: number;
    protected type: NetTaskDatagramType;
    protected payloadSize: number;
    protected logger!: DefaultLogger;

    public constructor(
        sessionId: Buffer,
        cryptoMark: Buffer,
        sequenceNumber: number,
        acknowledgementNumber: number,
        fragmented: boolean,
        type: NetTaskDatagramType,
        payloadSize: number
    ) {
        this.sessionId = sessionId;
        this.cryptoMark = cryptoMark;
        this.version = NET_TASK_VERSION;
        this.sequenceNumber = sequenceNumber;
        this.acknowledgementNumber = acknowledgementNumber;
        this.fragmented = fragmented;
        this.type = type;
        this.payloadSize = payloadSize;

        // this.logger = getOrCreateGlobalLogger();
        Object.defineProperty(this, "logger", {
            value: getOrCreateGlobalLogger(),
            enumerable: false,
            configurable: true
        });
    }

    public getSessionId(): Buffer { return this.sessionId; }
    public getCryptoMark(): Buffer { return this.cryptoMark; }
    public getVersion(): number { return this.version; }
    public getSequenceNumber(): number { return this.sequenceNumber; }
    public getAcknowledgementNumber(): number { return this.acknowledgementNumber; }
    public getFragmentedFlag(): boolean { return this.fragmented; }
    public getType(): NetTaskDatagramType { return this.type; }
    public getPayloadSize(): number { return this.payloadSize; }

    public toString(): string {
        // return  "--< NET TASK >--\n" +
        //         "  VERSION: " + this.version + "\n" +
        //         "  SEQUENCE_NUMBER: " + this.sequenceNumber + "\n" +
        //         "  ACKNOWLEDGEMENT_NUMBER: " + this.acknowledgementNumber + "\n" +
        //         "  IS_FRAGMENTED: " + this.fragmented + "\n" +
        //         "  TYPE: " + this.type + "\n" +
        //         "  PAYLOAD_SIZE: " + this.payloadSize + "\n";
        return dedent`"
            --< NET TASK >--
                - SESSION ID: ${this.sessionId}
                - ENCRYPTED: ${NET_TASK_CRYPTO.equals(this.cryptoMark)}
                - VERSION: ${this.version}
                - SEQUENCE_NUMBER: ${this.sequenceNumber}
                - ACKNOWLEDGEMENT_NUMBER: ${this.acknowledgementNumber}
                - IS_FRAGMENTED: ${this.fragmented}
                - TYPE: ${this.type}
                - PAYLOAD_SIZE: ${this.payloadSize}
        `;
    }

    public static isEncrypted(nt: NetTask): boolean;
    public static isEncrypted(pheader: NetTaskPublicHeader): boolean;
    public static isEncrypted(ntph: NetTask | NetTaskPublicHeader): boolean {
        const cryptoMark = ntph instanceof NetTask ? ntph.cryptoMark : ntph.cryptoMark; // Needed because TS.

        return NET_TASK_CRYPTO.equals(cryptoMark);
    }

    /**
     * First phase of the deserialization, used to verify the signature of a NetTask Datagram. 
     * Should always be used before {@link deserializeHeader} method.
     * @param reader BufferReader instanciated with a message buffer received from the server.
     * @returns A boolean representing whether or not the signature is valid.
     */
    public static verifySignature(reader: BufferReader): boolean {
        const sig = reader.read(4);

        return NET_TASK_SIGNATURE.equals(sig);
    }

    // /**
    //  * Second phase of the deserialization, returning a NetTask Datagram from a given message buffer.
    //  * @param reader BufferReader instanciated with a message buffer received from the server.
    //  * @returns A NetTask instance representing the deserialized message.
    //  */
    // public static deserializeHeader(reader: BufferReader): NetTask {
    //     const logger = getOrCreateGlobalLogger();
    //     const version = reader.readUInt32();
    //     if(version != NET_TASK_VERSION) {
    //         logger.pError(`NETTASK Datagram Invalid Version. Excepted: ${NET_TASK_VERSION}. Received: ${version}.`);
    //     }

    //     const sequenceNumber = reader.readUInt32();
    //     const acknowledgementNumber = reader.readUInt32();
    //     const fragmentedBool = reader.readInt8();
    //     const type = reader.readUInt32();
    //     const payloadSize = reader.readUInt32();

    //     return new NetTask(sequenceNumber, acknowledgementNumber, !!fragmentedBool, type, payloadSize);
    // }

    // /**
    //  * Serializes a {@link NetTask} object into network-transmittable buffers.
    //  */
    // public serializeHeader(): Buffer {
    //     const writer = new BufferWriter();
    //     writer.write(NET_TASK_SIGNATURE);
    //     writer.writeUInt32(this.version);
    //     writer.writeUInt32(this.sequenceNumber);
    //     writer.writeUInt32(this.acknowledgementNumber);
    //     writer.writeUInt8(+this.fragmented);
    //     writer.writeUInt32(this.type);
    //     writer.writeUInt32(this.payloadSize);

    //     return writer.finish();
    // }

    public serializePublicHeader(): Buffer {
        const writer = new BufferWriter();
        writer.write(NET_TASK_SIGNATURE);
        writer.write(this.sessionId);
        writer.write(this.cryptoMark);
        writer.writeUInt32(this.payloadSize);

        return writer.finish();
    }

    public serializePrivateHeader(): Buffer {
        const writer = new BufferWriter();

        writer.writeUInt32(this.version);
        writer.writeUInt32(this.sequenceNumber);
        writer.writeUInt32(this.acknowledgementNumber);
        writer.writeUInt8(+this.fragmented);
        writer.writeUInt32(this.type); 

        return writer.finish();
    }

    public static deserializePublicHeader(reader: BufferReader): NetTaskPublicHeader {
        const sessionId = reader.read(HASH_LEN);

        const cryptoMark = reader.read(NET_TASK_CRYPTO.byteLength);
        if (!NET_TASK_CRYPTO.equals(cryptoMark) && !NET_TASK_NOCRYPTO.equals(cryptoMark)) {
            throw new Error(`[NT] Deserialization Error: Invalid crypto mark. Received: ${cryptoMark.toString("hex")}`);
        }

        const payloadSize = reader.readUInt32();

        return { sessionId, cryptoMark, payloadSize };
    }

    public static deserializePrivateHeader(reader: BufferReader, partialHeader: NetTaskPublicHeader) {
        const version = reader.readUInt32();
        if (version !== NET_TASK_VERSION) {
            throw new Error(`[NT] Deserialization Error: Invalid Version. Excepted: ${NET_TASK_VERSION}. Received: ${version}.`);
        }

        const sequenceNumber = reader.readUInt32();
        const acknowledgementNumber = reader.readUInt32();
        const fragmentedBool = reader.readInt8();
        const type = reader.readUInt32();

        return new NetTask(
            partialHeader.sessionId, 
            partialHeader.cryptoMark, 
            sequenceNumber, 
            acknowledgementNumber, 
            !!fragmentedBool, 
            type, 
            partialHeader.payloadSize
        );
    }
}

class NetTaskRejected extends NetTask {
    public constructor(
        sessionId: Buffer,
        sequenceNumber: number,
        acknowledgementNumber: number
    ) {
        super(
            sessionId,
            NET_TASK_NOCRYPTO,
            sequenceNumber,
            acknowledgementNumber,
            false,
            NetTaskDatagramType.CONNECTION_REJECTED,
            0
        );
    }

    public serialize() {
        const privHeader = super.serializePrivateHeader();
        this.payloadSize = privHeader.byteLength;

        const pubHeader = super.serializePublicHeader();
        const newWriter = new BufferWriter();

        newWriter.write(pubHeader);
        newWriter.write(privHeader);

        return newWriter.finish();
    }
}

//#region ============== REGISTER PROCESS ==============
class NetTaskRegister extends NetTask {
    private _publicKey: Buffer;

    public constructor (
        sessionId: Buffer,
        sequenceNumber: number,
        acknowledgementNumber: number,
        fragmented: boolean,
        publicKey: Buffer
    ) {
        super(
            sessionId,
            NET_TASK_NOCRYPTO,
            sequenceNumber, 
            acknowledgementNumber,
            fragmented,
            NetTaskDatagramType.REQUEST_REGISTER, 
            0
        );
        this._publicKey = publicKey;
    }

    public get publicKey(): Buffer { return this._publicKey; }

    public serialize(): Buffer {
        const privHeader = super.serializePrivateHeader();
        this.payloadSize = privHeader.byteLength + 4 + this._publicKey.byteLength;

        const pubHeader = super.serializePublicHeader();
        const newWriter = new BufferWriter();

        newWriter.write(pubHeader);
        newWriter.write(privHeader);
        newWriter.writeUInt32(this._publicKey.byteLength);
        newWriter.write(this._publicKey);

        // const logger = getOrCreateGlobalLogger();
        // logger.log("[NT_Register] WRITE BUF:", newWriter.finish().toString("hex").match(/../g));

        return newWriter.finish();
    }

    public static deserialize(reader: BufferReader, dg: NetTask): NetTaskRegister {
        if (dg.getType() != NetTaskDatagramType.REQUEST_REGISTER) {
            throw new Error(`[NT_Register] Deserialization Error: Not a Register datagram.`);
        }

        // const logger = getOrCreateGlobalLogger();
        // logger.log("[NT_Register] BUF:", reader);

        const publicKeyLen = reader.readUInt32();
        // logger.log("[NT_Register] PKLEN:", publicKeyLen);
        const publicKey = reader.read(publicKeyLen);

        return new NetTaskRegister(
            dg.getSessionId(),
            dg.getSequenceNumber(), 
            dg.getAcknowledgementNumber(),
            dg.getFragmentedFlag(), 
            publicKey
        );
    }
}

class NetTaskRegisterChallenge extends NetTask {
    private _publicKey: Buffer;
    private _challenge: Buffer;
    private _salt: Buffer;

    public constructor (
        sessionId: Buffer,
        sequenceNumber: number,
        acknowledgementNumber: number,
        fragmented: boolean,
        publicKey: Buffer,
        challenge: Buffer,
        salt: Buffer
    ) {
        super(
            sessionId,
            NET_TASK_NOCRYPTO,
            sequenceNumber,
            acknowledgementNumber,
            fragmented,
            NetTaskDatagramType.REGISTER_CHALLENGE, 
            0
        );
        this._publicKey = publicKey;
        this._challenge = challenge;
        this._salt = salt;
    }

    public get publicKey(): Buffer { return this._publicKey; }
    public get salt(): Buffer { return this._salt; }
    public get challenge(): Buffer { return this._challenge; }

    public serialize(): Buffer {
        const privHeader = super.serializePrivateHeader();
        this.payloadSize = privHeader.byteLength
            + this._publicKey.byteLength
            + this._challenge.byteLength
            + this._salt.byteLength
            + 4 * 3;

        const pubHeader = super.serializePublicHeader();
        const newWriter = new BufferWriter();

        newWriter.write(pubHeader);
        newWriter.write(privHeader);
        newWriter.writeUInt32(this._publicKey.byteLength);
        newWriter.write(this._publicKey);
        newWriter.writeUInt32(this._challenge.byteLength);
        newWriter.write(this._challenge);
        newWriter.writeUInt32(this._salt.byteLength);
        newWriter.write(this._salt);

        return newWriter.finish();
    }

    public static deserialize(reader: BufferReader, dg: NetTask): NetTaskRegisterChallenge {
        if (dg.getType() != NetTaskDatagramType.REGISTER_CHALLENGE) {
            throw new Error(`[NT_RegisterChallenge] Deserialization Error: Not a RegisterChallenge datagram.`);
        }

        const publicKeyLen = reader.readUInt32();
        const publicKey = reader.read(publicKeyLen);
        const challengeLen = reader.readUInt32();
        const challenge = reader.read(challengeLen);
        const saltLen = reader.readUInt32();
        const salt = reader.read(saltLen);

        return new NetTaskRegisterChallenge(
            dg.getSessionId(),
            dg.getSequenceNumber(), 
            dg.getAcknowledgementNumber(),
            dg.getFragmentedFlag(), 
            publicKey, 
            challenge,
            salt
        );
    }
}

// class NetTaskRegisterChallenge2 extends NetTask {
//     private _challenge: Buffer;
//     private ecdhe?: ECDHE;

//     public constructor (
//         sessionId: Buffer,
//         sequenceNumber: number,
//         acknowledgementNumber: number,
//         fragmented: boolean,
//         payloadSize: number,
//         challenge: Buffer
//     ) {
//         super(
//             sessionId,
//             NET_TASK_CRYPTO,
//             sequenceNumber,
//             acknowledgementNumber,
//             fragmented,
//             NetTaskDatagramType.REGISTER_CHALLENGE2, 
//             payloadSize
//         );
//         this._challenge = challenge;
//     }

//     public get challenge(): Buffer { return this._challenge; }

//     public link(ecdhe: ECDHE): this {
//         this.ecdhe = ecdhe;
//         return this;
//     }

//     public serialize(): Buffer {
//         if (!this.ecdhe) {
//             throw new Error(`[NT_RegisterChallenge2] Serialization Error: Datagram not linked against an ECDHE instance.`);
//         }
        
//         // Write Payload
//         const payloadWriter = new BufferWriter();
//         const privHeader = super.serializePrivateHeader();

//         payloadWriter.write(privHeader);
//         payloadWriter.writeUInt32(this._challenge.byteLength);
//         payloadWriter.write(this._challenge);


//         const logger = getOrCreateGlobalLogger();

//         // Envelope payload
//         let envelope: Buffer; 
//         try {
//             const msg = this.ecdhe.envelope(payloadWriter.finish());
//             logger.log("[NT_RegisterChallenge2] MSG:", msg);
//             envelope = ECDHE.serializeEncryptedMessage(msg);
//             this.payloadSize = envelope.byteLength;
//         } catch (e) {
//             throw new Error(`[NT_RegisterChallenge2] Serialization Error: Crypto error:`, { cause: e });
//         }

//         const pubHeader = super.serializePublicHeader();
//         const dgramWriter = new BufferWriter();
//         dgramWriter.write(pubHeader);
//         dgramWriter.write(envelope);

//         logger.log(
//             "[NT_RegisterChallenge2] BUF:", 
//             envelope.toString("hex").match(/../g), 
//             envelope.byteLength, 
//             this.payloadSize
//         );

//         return dgramWriter.finish();
//     }

//     public static deserialize(reader: BufferReader, dg: NetTask): NetTaskRegisterChallenge2 {
//         if (dg.getType() != NetTaskDatagramType.REGISTER_CHALLENGE2) {
//             throw new Error(`[NT_RegisterChallenge2] Deserialization Error: Not a RegisterChallenge2 datagram.`);
//         }

//         const challengeLen = reader.readUInt32();
//         const challenge = reader.read(challengeLen);

//         return new NetTaskRegisterChallenge2(
//             dg.getSessionId(),
//             dg.getSequenceNumber(), 
//             dg.getAcknowledgementNumber(), 
//             dg.getFragmentedFlag(),
//             dg.getPayloadSize(), 
//             challenge
//         );
//     }
// }
class NetTaskRegisterChallenge2 extends NetTask {
    private _challenge: Buffer;
    private ecdhe?: ECDHE;

    public constructor (
        sessionId: Buffer,
        sequenceNumber: number,
        acknowledgementNumber: number,
        fragmented: boolean,
        challenge: Buffer
    ) {
        super(
            sessionId,
            NET_TASK_NOCRYPTO,
            sequenceNumber,
            acknowledgementNumber,
            fragmented,
            NetTaskDatagramType.REGISTER_CHALLENGE2, 
            0
        );
        this._challenge = challenge;
    }

    public get challenge(): Buffer { return this._challenge; }

    public link(ecdhe: ECDHE): this {
        this.ecdhe = ecdhe;
        return this;
    }

    public serialize(): Buffer {
        if (!this.ecdhe) {
            throw new Error(`[NT_RegisterChallenge2] Serialization Error: Datagram not linked against an ECDHE instance.`);
        }
        
        // Write Payload
        const privHeader = super.serializePrivateHeader();
        this.payloadSize = privHeader.byteLength + this.challenge.byteLength + 4;


        const pubHeader = super.serializePublicHeader();
        const dgramWriter = new BufferWriter();
        dgramWriter.write(pubHeader);
        dgramWriter.write(privHeader);
        dgramWriter.writeUInt32(this._challenge.byteLength);
        dgramWriter.write(this._challenge);

        return dgramWriter.finish();
    }

    public static deserialize(reader: BufferReader, dg: NetTask): NetTaskRegisterChallenge2 {
        if (dg.getType() != NetTaskDatagramType.REGISTER_CHALLENGE2) {
            throw new Error(`[NT_RegisterChallenge2] Deserialization Error: Not a RegisterChallenge2 datagram.`);
        }

        const challengeLen = reader.readUInt32();
        const challenge = reader.read(challengeLen);

        return new NetTaskRegisterChallenge2(
            dg.getSessionId(),
            dg.getSequenceNumber(), 
            dg.getAcknowledgementNumber(), 
            dg.getFragmentedFlag(),
            challenge
        );
    }
}

//#endregion ============== REGISTER PROCESS ==============
class NetTaskPushSchemas extends NetTask {
    private spack!: SPACKPacked | { [key: string]: SPACKTask; };
    // private message: string;
    private ecdhe?: ECDHE;

    public constructor(
        sessionId: Buffer,
        sequenceNumber: number,
        acknowledgementNumber: number,
        fragmented: boolean,
        spack: SPACKPacked | { [key: string]: SPACKTask; }
        // message: string
    ) {
        super(
            sessionId, 
            NET_TASK_CRYPTO, 
            sequenceNumber, 
            acknowledgementNumber, 
            fragmented, 
            NetTaskDatagramType.PUSH_SCHEMAS, 
            0
        );
        this.spack = spack;

        // this.message = message;
        // this.spack = <never>serializeSPACK;
        // (() => this.spack)();
    }

    public getSchemas() {
        return this.spack;
    }

    public link(ecdhe: ECDHE): this {
        this.ecdhe = ecdhe;
        return this;
    }

    public serialize(): Buffer {
        if (!this.ecdhe) {
            throw new Error(`[NT_PushSchemas] Serialization Error: Datagram not linked against an ECDHE instance.`);

        }

        // this.logger.info("SPACK:", this.spack);
        // const pack = serializeSPACK(this.spack);
        let pack: Buffer;
        if (isSPACKTaskCollection(this.spack)) {
            // this.logger.info("TRUESPACK:", Object.fromEntries(Object.entries(this.spack).map(([k,v]) => [k, <Task>(<_SPACKTask>v).getUnpacked()])));
            // this.logger.info("TRUESPACKPACK:", packTaskSchemas(Object.fromEntries(Object.entries(this.spack).map(([k,v]) => [k, <Task>(<_SPACKTask>v).getUnpacked()]))));
            pack = serializeSPACK(packTaskSchemas(
                Object.fromEntries(Object.entries(this.spack).map(([k,v]) => [k, <never>(<_SPACKTask>v).getUnpacked()]))
            ));
        } else {
            pack = serializeSPACK(this.spack);
        }
        // this.logger.info("SERSPACK:", pack.toString("hex"));
        
        // this.payloadSize = pack.byteLength;

        // const enc = this.ecdhe?.encrypt(this.message);
        const packLen = Buffer.alloc(4);
        packLen.writeUInt32BE(pack.byteLength);
        const packCompound = Buffer.concat([packLen, pack]);

        const enc = this.ecdhe.encrypt(packCompound);
        const serENC = ECDHE.serializeEncryptedMessage(enc);

        const payloadWriter = new BufferWriter();
        const privHeader = super.serializePrivateHeader();
        payloadWriter.write(privHeader);
        payloadWriter.writeUInt32(serENC.byteLength);
        payloadWriter.write(serENC);

        // this.logger.log("[NT_PS] PACK:", pack);

        // Envelope payload
        let envelope: Buffer; 
        try {
            envelope = ECDHE.serializeEncryptedMessage(this.ecdhe.envelope(payloadWriter.finish()));
            this.payloadSize = envelope.byteLength;
        } catch (e) {
            throw new Error(`[NT_PushSchemas] Serialization Error: Crypto error:`, { cause: e });
        }

        const pubHeader = super.serializePublicHeader();
        const dgramWriter = new BufferWriter();
        dgramWriter.write(pubHeader);
        dgramWriter.write(envelope);

        return dgramWriter.finish();
    }

    public static deserialize(reader: BufferReader, ecdhe: ECDHE, dg: NetTask): NetTaskPushSchemas {
        // const logger = getOrCreateGlobalLogger();

        if (dg.getType() != NetTaskDatagramType.PUSH_SCHEMAS) {
            throw new Error(`[NT_PushSchemas] Deserialization Error: Not a PushSchemas datagram.`);
        }

        const serEncLen = reader.readUInt32();
        const serEnc = reader.read(serEncLen);
        const desMessage = ECDHE.deserializeEncryptedMessage(serEnc);
        const message = ecdhe.decrypt(desMessage);

        let tasks: { [key: string]: SPACKTask; } = {};
        try {
            const spackLen = message.readUInt32BE();
            const rawSpack = message.subarray(4, spackLen + 4);
            // logger.log("[NT_PS] PACK:", rawSpack);

            const spack = deserializeSPACK(rawSpack);
            // logger.log("DESER:", spack);
            tasks = unpackTaskSchemas(<SPACKTaskCollectionPacked>spack);
        } catch (e) {
            throw new Error(`[NT_PushSchemas] Malformed NetTaskPushSchemas packet: Malformed schema payload.`, { cause: e });
        }

        return new NetTaskPushSchemas(dg.getSessionId(), 123123, 123123, true, tasks);
    }
}

class NetTaskMetric extends NetTask {
    private spack!: SPACKTaskMetric;
    private ecdhe?: ECDHE;
    private taskId: string;
    private task: object;

    public constructor(
        sessionId: Buffer,
        sequenceNumber: number,
        acknowledgementNumber: number,
        fragmented: boolean,
        spack: SPACKTaskMetric,
        taskId: string,
        // Should be of type Task, but I don't want to import stuff from the server into common, 
        // and I'm too much of a lazy fuck to move the config to common.
        task: object
    ) {
        super(
            sessionId, 
            NET_TASK_CRYPTO, 
            sequenceNumber, 
            acknowledgementNumber, 
            fragmented, 
            NetTaskDatagramType.SEND_METRICS, 
            0
        );

        this.spack = spack;
        this.taskId = taskId;
        this.task = task;
    }

    public getMetrics() {
        return this.spack;
    }

    public link(ecdhe: ECDHE): this {
        this.ecdhe = ecdhe;
        return this;
    }

    public serialize(): Buffer {
        if (!this.ecdhe) {
            throw new Error(`[NT_PushSchemas] Serialization Error: Datagram not linked against an ECDHE instance.`);
        }

        const pack = serializeTaskMetric(this.spack, <never>this.task);
        // this.logger.log("[NT_PushSchemas] PACK ARGS:", this.spack, this.task);
        // this.logger.log("[NT_PushSchemas] PACK:", pack, pack.byteLength);

        const taskLen = Buffer.alloc(4);
        taskLen.writeUInt32BE(this.taskId.length);

        const packLen = Buffer.alloc(4);
        packLen.writeUInt32BE(pack.byteLength);
        const packCompound = Buffer.concat([taskLen, Buffer.from(this.taskId, "utf8"), packLen, pack]);

        const enc = this.ecdhe.encrypt(packCompound);
        const serENC = ECDHE.serializeEncryptedMessage(enc);

        const payloadWriter = new BufferWriter();
        const privHeader = super.serializePrivateHeader();
        payloadWriter.write(privHeader);
        payloadWriter.writeUInt32(serENC.byteLength);
        payloadWriter.write(serENC);

        // Envelope payload
        let envelope: Buffer; 
        try {
            envelope = ECDHE.serializeEncryptedMessage(this.ecdhe.envelope(payloadWriter.finish()));
            this.payloadSize = envelope.byteLength;
        } catch (e) {
            throw new Error(`[NT_PushSchemas] Serialization Error: Crypto error:`, { cause: e });
        }

        const pubHeader = super.serializePublicHeader();
        const dgramWriter = new BufferWriter();
        dgramWriter.write(pubHeader);
        dgramWriter.write(envelope);

        return dgramWriter.finish();
    }

    public static deserialize(reader: BufferReader, ecdhe: ECDHE, dg: NetTask, configTasks: object): NetTaskMetric {
        // const logger = getOrCreateGlobalLogger();

        if (dg.getType() != NetTaskDatagramType.SEND_METRICS) {
            throw new Error(`[NT_PushSchemas] Deserialization Error: Not a PushSchemas datagram.`);
        }

        const serEncLen = reader.readUInt32();
        const serEnc = reader.read(serEncLen);
        const desMessage = ECDHE.deserializeEncryptedMessage(serEnc);
        const message = ecdhe.decrypt(desMessage);
        const messageReader = new BufferReader(message);

        // logger.log("[NT_PushSchemas] MESSAGE:", message);

        const metric = { taskId: "", metrics: <SPACKTaskMetric>{} };
        try {
            const taskIdLen = messageReader.readUInt32();
            metric.taskId = messageReader.read(taskIdLen).toString("utf8");

            const spackLen = messageReader.readUInt32();
            const rawSpack = messageReader.read(spackLen);

            metric.metrics = deserializeTaskMetric(
                rawSpack, 
                // In order to not import stuff from server into common, we do this hack to simply accept whatever.
                // It's the responsability of the user to guarantee this doesn't explode on their hands.
                <never>(<Record<string, unknown>>configTasks)[<keyof typeof configTasks>metric.taskId]
            );
        } catch (e) {
            throw new Error(`[NT_Metric] Malformed NetTaskMetric packet: Malformed schema payload.`, { cause: e });
        }

        return new NetTaskMetric(
            dg.getSessionId(), 
            dg.getSequenceNumber(), 
            dg.getAcknowledgementNumber(), 
            true, 
            metric.metrics,
            metric.taskId,
            <never>(<Record<string, unknown>>configTasks)[<keyof typeof configTasks>metric.taskId]
        );
    }
}

export {
    NetTask,
    NetTaskDatagramType,
    NetTaskRejected,
    NetTaskRegister,
    NetTaskRegisterChallenge,
    NetTaskRegisterChallenge2,
    NetTaskPushSchemas,
    NetTaskMetric
};