import {
    Client,
    Message,
    TextChannel,
    Constants,
    User,
} from 'discord.js';
import logs from 'discord-logs';
import { ConfigDatabase, SessionConfig } from './ConfigDatabase';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';
import { SessionMonitor } from './SessionMonitor';

dayjs.extend(relativeTime);
dayjs.extend(duration);

const client = new Client({ partials: Object.values(Constants.PartialTypes)  });
logs(client);

const ROLE_NAME = 'Game Statistics'

class Bot {

    private sessionMonitor: SessionMonitor;

    private commandActions = {
        
    };

    constructor() {
        this.commandActiveGamers = this.commandActiveGamers.bind(this);
        this.commandGamerSessions = this.commandGamerSessions.bind(this);
        this.commandMostPopularGames = this.commandMostPopularGames.bind(this);
        this.commandWhoPlays = this.commandWhoPlays.bind(this);
        this.chunkString = this.chunkString.bind(this);
        this.safe = this.safe.bind(this);
        this.start = this.start.bind(this);
        this.handleCommands = this.handleCommands.bind(this);
        this.setupSessionEvents = this.setupSessionEvents.bind(this);
        this.groupBy = this.groupBy.bind(this);
        this.groupByAppNameAndSumDuration = this.groupByAppNameAndSumDuration.bind(this);

        this.sessionMonitor = new SessionMonitor(client);
        this.setupSessionEvents();

        this.commandActions['activegamers'] = this.commandActiveGamers;
        this.commandActions['gamersessions'] = this.commandGamerSessions;
        this.commandActions['populargames'] = this.commandMostPopularGames;
        this.commandActions['whoplays'] = this.commandWhoPlays;

    }

    private setupSessionEvents() {
        this.sessionMonitor.onSessionStart = async (act, startedSession: SessionConfig) => {
            // Alert user via DM for now?
            // TODO: Alert user on guild?? More annoying -.-
            try {
                const targetUser = client.users.cache.find(u => u.id === act.userId);
                const dmChannel = await targetUser.createDM();
                // Dupe messages?
                //await dmChannel.send(`You started playing a new session of ${this.safe(act.name)}, have fun, game responsibly...`);
                //console.log('DM successfully sent!');
            } catch (e) {
                console.error('Failed to alert user via dm (disabled?) who started a session', e);
            }
        };
        this.sessionMonitor.onSessionEnd = async (act, endedSession: SessionConfig) => {
            // Alert user via DM for now?
            // TODO: Alert user on guild?? More annoying -.-
            try {
                const targetUser = client.users.cache.find(u => u.id === act.userId);
                const dmChannel = await targetUser.createDM();
                console.log('Ended', endedSession);

                if (endedSession.startTime) {
                    const formattedStartTime = dayjs((<number>endedSession.startTime));
                    const curTime = dayjs();
                    const timePlayedHuman = formattedStartTime.from(curTime, true);
                }
                //await dmChannel.send(`You played a session of ${this.safe(act.name)} for ${timePlayedHuman}, hope you had fun!`);
                //console.log('DM successfully sent!');
            } catch (e) {
                console.error('Failed to alert user via dm (disabled?) who ended a session', e);
            }
        };
    }

    private chunkString(str: string, size: number) {
        const numChunks = Math.ceil(str.length / size)
        const chunks = new Array(numChunks)

        for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
            chunks[i] = str.substr(o, size)
        }

        return chunks;
    }

    private safe(str: string) {
        return str.replace(/`/g, '');
    }

    public start() {

        (<any>client).on('messageContentEdited', this.handleCommands);
        client.on('message', this.handleCommands);
        client.on("guildCreate", guild => {
            console.log(`New guild joined: ${guild.name} (id: ${guild.id}). This guild has ${guild.memberCount} members!`);
            client.user.setActivity(`Serving ${client.guilds.cache.size} servers`);
        });

        client.on('ready', () => {

            console.log(`Bot has started, with ${client.users.cache.size} users in cache, in ${client.channels.cache.size} cached channels of ${client.guilds.cache.size} cached guilds.`); 
            client.user.setActivity(`Serving ${client.guilds.cache.size} servers`);
            console.log(`Logged in as ${client.user.tag}!`);
        
            this.sessionMonitor.startSessionMonitor();
            
        });
        

        client.login(process.env.DISCORD_BOT_TOKEN);
    }

    

    private async handleCommands(message: Message) {
        // Fetch the full message if partial.
        if (message.partial)
            await message.fetch();
        // Skip itself, do not allow it to process its own messages.
        if (message.author.id === client.user.id)
            return;
        // Skip other bots now.
        if (message.author.bot)
            return;

        // Only those with the Game Statistics role can use the commands.
        if (!message.member.roles.cache.find(role => role.name === ROLE_NAME))
            return;
        
        // Check for commands always before.
        if (message.content.indexOf('!') === 0) {
            const args = message.content.slice(1).trim().split(/ +/g);
            const command = args.shift().toLowerCase();

            if (Object.keys(this.commandActions).indexOf(command) > -1) {
                this.commandActions[command](args, message);
            }
        }
    }

    private async commandActiveGamers(args: string[], message: Message) {
       
        try {
            let messagePrefix = 'Current Active Gamers: ';
            let messageQueue = [];
            const activeSessionsForServer = await ConfigDatabase.getSessionsForGuildsById([message.guild.id], null, null, null, true);

            activeSessionsForServer.forEach(sess => {
                const formattedStartTime = dayjs((<number>sess.startTime));
                const curTime = dayjs();
                const timePlayedHuman = formattedStartTime.from(curTime, true);
                const member = message.guild.members.cache.find(mem => mem.user.id == sess.userId);

                if (member) {
                    const textToAdd = `

**Player:** <@${member.user.id}> (${this.safe(member.user.tag)})
**Game:** ${this.safe(sess.activityName)}
**Time Played (this session):** ${timePlayedHuman}
------`
                    if ((messagePrefix + textToAdd).length >= 1800) {
                        messageQueue.push(messagePrefix);
                        messagePrefix = 'Current Active Gamers: ';
                    }
                    messagePrefix += textToAdd;
                }
            });
            messageQueue.push(messagePrefix);
            messageQueue.forEach(msg => {
                if (msg !== '') {
                    message.reply(msg);
                }
            });

        } catch (e) {
            console.error('Command Gamers', e);
            await message.reply('Wow, something really went wrong, I do apologise. Try again later.');
        }
    }

    private async commandGamerSessions(args: string[], message: Message) {
       
        try {
            let messagePrefix = 'Gamer Sessions: ';
            let messageQueue = [];
            const targetUsers = message.mentions.users.map(u => u.id);

            const sessionsForUsersOnServer = await ConfigDatabase.getSessionsForGuildsAndUsersById([message.guild.id], targetUsers, null, null, null, false);

            sessionsForUsersOnServer.forEach(sess => {
                const formattedStartTime = dayjs((<number>sess.startTime));
                const curTime = (<number>sess.endTime) === -1 ? dayjs() : dayjs(<number>sess.endTime);

                const timePlayedHuman = formattedStartTime.from(curTime, true);
                const member = message.guild.members.cache.find(mem => mem.user.id == sess.userId);
                
                if (member) {
                    const textToAdd = `

**Player:** <@${member.user.id}> (${this.safe(member.user.tag)})
**Game:** ${this.safe(sess.activityName)}
**Time Played:** ${timePlayedHuman}
------`
                    if ((messagePrefix + textToAdd).length >= 1800) {
                        messageQueue.push(messagePrefix);
                        messagePrefix = 'Gamer Sessions: ';
                    }
                    messagePrefix += textToAdd;
                }
            });
            messageQueue.push(messagePrefix);
            messageQueue.forEach(msg => {
                if (msg !== '') {
                    message.reply(msg);
                }
            });

        } catch (e) {
            console.error('Command Gamer Sessions', e);
            await message.reply('Wow, something really went wrong, I do apologise. Try again later.');
        }
    }

    private async commandMostPopularGames(args: string[], message: Message) {
       
        try {
            let messagePrefix = 'Top 10 Games: ';
            let messageQueue = [];
            const targetUsers = message.mentions.users.map(u => u.id);

            const sessionsForGuild = await ConfigDatabase.getSessionsForGuildsById([message.guild.id], null, null, null, false);
            const groupedBy = this.groupByAppNameAndSumDuration(sessionsForGuild);

            groupedBy.slice(0, 10).forEach(app => {
                const timePlayedHuman = dayjs.duration({ milliseconds: app.durationMs }).humanize();

                const textToAdd = `

**Game:** ${this.safe(app.activityName)}
**Total Time Played:** ${timePlayedHuman}
------`
                if ((messagePrefix + textToAdd).length >= 1800) {
                    messageQueue.push(messagePrefix);
                    messagePrefix = 'Top 10 Games: ';
                }
                messagePrefix += textToAdd;
            });
            messageQueue.push(messagePrefix);
            messageQueue.forEach(msg => {
                if (msg !== '') {
                    message.reply(msg);
                }
            });

        } catch (e) {
            console.error('Command Most Popular Games', e);
            await message.reply('Wow, something really went wrong, I do apologise. Try again later.');
        }
    }

    private async commandWhoPlays(args: string[], message: Message) {
        if (args.length < 1) {
            return;
        }
        try {
            let messagePrefix = 'Results: ';
            let messageQueue = [];

            const sessionsForGuild = await ConfigDatabase.getSessionsForGuildsById([message.guild.id], `${args[0]}`, null, null, false);
            const groupedBy = this.groupByAppNameAndSumDuration(sessionsForGuild);

            groupedBy.forEach(app => {
                const timePlayedHuman = dayjs.duration({ milliseconds: app.durationMs }).humanize();
                const userMentions = app.users.map(u => {
                    return `<@${u.id}> (${this.safe(u.tag)})`
                })

                const textToAdd = `

**Game:** ${this.safe(app.activityName)}
**Players:** ${userMentions.join(', ')}
**Total Time Played:** ${timePlayedHuman}
------`
                if ((messagePrefix + textToAdd).length >= 1800) {
                    messageQueue.push(messagePrefix);
                    messagePrefix = 'Results: ';
                }
                messagePrefix += textToAdd;
            });
            messageQueue.push(messagePrefix);
            messageQueue.forEach(msg => {
                if (msg !== '') {
                    message.reply(msg);
                }
            });

        } catch (e) {
            console.error('Command Who Plays', e);
            await message.reply('Wow, something really went wrong, I do apologise. Try again later.');
        }
    }

    private groupByAppNameAndSumDuration(sessions: SessionConfig[]): { activityName: string, durationMs: number, users: User[] }[] {
        let results: { activityName: string, durationMs: number, users: User[] }[] = [];

        const groupedBy = this.groupBy<SessionConfig>(sessions, ['activityName']);
        const activityNameKeys = Object.keys(groupedBy);
        const dateNow = new Date().getTime();

        activityNameKeys.forEach(activityName => {
            const sessionsForApp = groupedBy[activityName];
            const sessionsWithDuration = sessionsForApp.map(sess => {
                return {
                    ...sess,
                    durationMs: ((<number>sess.endTime) === -1 ?  dateNow : <number>sess.endTime) - <number>sess.startTime
                }
            });
            const totalSessionTime = sessionsWithDuration.reduce((prev, cur) => prev + cur.durationMs, 0);

            // Unique all user id's for app.
            const allUsers = sessionsWithDuration.map(sess => sess.userId).filter((v, i, s) => s.indexOf(v) === i);
            const allUserObjects = client.users.cache.filter(v => allUsers.includes(v.id)).array();

            results.push({
                activityName: activityName,
                durationMs: totalSessionTime,
                users: allUserObjects
            });
        });

        // Sort descending
        return results.sort((a, b) => b.durationMs - a.durationMs);
    }

    private groupBy<T>(arr: T[], keys: (keyof T)[]): { [key: string]: T[] } {
        return arr.reduce((storage, item) => {
            const objKey = keys.map(key => `${ item[key] }`).join(':');
            if (storage[objKey]) {
              storage[objKey].push(item);
            } else {
              storage[objKey] = [item];
            }
            return storage;
          }, {} as { [key: string]: T[] });
    };
}

export = new Bot();