import { MapSchema, Schema, type } from "@colyseus/schema";
import { PlayerState } from "./PlayerState";

export class GameRoomState extends Schema {
    @type("string")
    roomId = "";

    @type("boolean")
    hasPassword = false;

    @type("boolean")
    isGameStarted = false;

    @type({ map: PlayerState })
    players = new MapSchema<PlayerState>();
}
